import { agentManifest } from '@work/shared/agent-manifest';
export { agentManifest } from '@work/shared/agent-manifest';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { estimateDaysSchema, uuid as sharedUuid, versionBody } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
import { requireAgentWrite } from '../middleware/auth';
import { getTask, taskSelect } from '../repositories/tasks';

const prefix = '/api/agent/v1';
const uuid = sharedUuid.transform((value) => value.toLowerCase());
const properties = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.record(z.unknown()).nullable().optional(),
  descriptionText: z.string().max(100000).nullable().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  stateId: uuid.optional(),
  laneId: uuid.nullable().optional(),
  responsibleUserId: uuid.optional(),
  typeId: uuid.optional(),
  milestoneId: uuid.nullable().optional(),
  parentId: uuid.nullable().optional(),
  startDate: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  estimateDays: estimateDaysSchema.nullable().optional(),
  sortKey: z.string().min(1).max(100).optional(),
});
const createBody = properties
  .extend({
    title: z.string().trim().min(1).max(255),
    responsibleUserId: uuid,
    participantUserIds: z.array(uuid).max(200).optional(),
    requesterId: uuid.optional(),
    clientMutationId: uuid,
  })
  .strict();
const updateBody = properties
  .merge(versionBody)
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'expectedVersion'));
const listQuery = z
  .object({
    boardId: uuid.optional(),
    q: z.string().trim().min(1).max(200).optional(),
    stateGroup: z
      .enum(['backlog', 'unstarted', 'started', 'waiting', 'completed', 'cancelled'])
      .optional(),
    responsibleUserId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
const cursorValue = z
  .object({ version: z.literal(1), after: uuid, filter: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
type Db = Pick<pg.PoolClient, 'query'>;
const emptyQuery = z.object({}).strict();
function withoutQuery(req: FastifyRequest) {
  emptyQuery.parse(req.query);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function authorization(req: FastifyRequest) {
  if (!req.agentAuthorization) throw new AppError('UNAUTHENTICATED');
  return req.agentAuthorization;
}

async function scopedBoard(req: FastifyRequest, boardId: string, db: Db = pool) {
  const board = (
    await db.query(
      'SELECT b.*,can_manage_board($1,b.id) AS can_manage FROM board b WHERE b.id=$2 AND b.workspace_id=$3 AND can_read_board($1,b.id)',
      [req.actor.id, boardId, authorization(req).workspaceId],
    )
  ).rows[0];
  if (!board) throw new AppError('NOT_FOUND');
  return board;
}

async function scopedTask(req: FastifyRequest, taskId: string, db: Db = pool) {
  const task = (
    await db.query(
      'SELECT t.id FROM task t WHERE t.id=$2 AND t.workspace_id=$3 AND can_read_task($1,t.id)',
      [req.actor.id, taskId, authorization(req).workspaceId],
    )
  ).rows[0];
  if (!task) throw new AppError('NOT_FOUND');
}

export async function registerAgentData(app: FastifyInstance) {
  app.get(prefix, async (req) => {
    withoutQuery(req);
    return agentManifest;
  });
  app.get(`${prefix}/me`, async (req) => {
    withoutQuery(req);
    const grant = authorization(req);
    const { id, display_name, avatar_url, status, is_platform_admin, wip_limit, used_wip } =
      req.actor;
    return {
      user: { id, display_name, avatar_url, status, is_platform_admin, wip_limit, used_wip },
      authorization: {
        id: grant.id,
        clientName: grant.clientName,
        workspaceId: grant.workspaceId,
        scopes: grant.scopes,
      },
    };
  });
  app.get(`${prefix}/workspace`, async (req) => {
    withoutQuery(req);
    const workspace = (
      await pool.query(
        'SELECT w.*,workspace_role($1,w.id) AS role FROM workspace w WHERE w.id=$2 AND workspace_role($1,w.id) IS NOT NULL',
        [req.actor.id, authorization(req).workspaceId],
      )
    ).rows[0];
    if (!workspace) throw new AppError('NOT_FOUND');
    return workspace;
  });
  app.get(`${prefix}/boards`, async (req) => {
    withoutQuery(req);
    return (
      await pool.query(
        'SELECT b.*,can_manage_board($1,b.id) AS can_manage FROM board b WHERE b.workspace_id=$2 AND can_read_board($1,b.id) ORDER BY b.name,b.id',
        [req.actor.id, authorization(req).workspaceId],
      )
    ).rows;
  });
  app.get(`${prefix}/boards/:boardId`, async (req) => {
    withoutQuery(req);
    const boardId = z.object({ boardId: uuid }).strict().parse(req.params).boardId;
    const board = await scopedBoard(req, boardId);
    const [states, lanes, types, milestones, labels, workers] = await Promise.all([
      ...['board_state', 'board_lane', 'board_task_type', 'milestone', 'label'].map((table) =>
        pool.query(
          `SELECT * FROM ${table} WHERE board_id=$1 ORDER BY ${['board_state', 'board_lane', 'board_task_type'].includes(table) ? 'sort_order,id' : 'name,id'}`,
          [boardId],
        ),
      ),
      pool.query(
        'SELECT u.id AS "userId",u.display_name AS "displayName",u.avatar_url AS "avatarUrl",wip_usage(u.id) AS "usedWip",u.wip_limit AS "wipLimit" FROM app_user u WHERE is_worker_eligible(u.id,$1) ORDER BY u.display_name,u.id',
        [boardId],
      ),
    ]);
    return {
      board,
      states: states.rows,
      lanes: lanes.rows,
      types: types.rows,
      milestones: milestones.rows,
      labels: labels.rows,
      workers: workers.rows,
    };
  });
  app.get(`${prefix}/tasks`, async (req) => {
    const query = listQuery.parse(req.query);
    const workspaceId = authorization(req).workspaceId;
    if (query.boardId) await scopedBoard(req, query.boardId);
    const filter = createHash('sha256')
      .update(
        JSON.stringify([
          workspaceId,
          query.boardId,
          query.q,
          query.stateGroup,
          query.responsibleUserId,
        ]),
      )
      .digest('hex');
    let after: string | null = null;
    if (query.cursor) {
      try {
        const cursor = cursorValue.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
        if (cursor.filter !== filter) throw new Error('cursor filter mismatch');
        after = cursor.after;
      } catch {
        throw new AppError('VALIDATION_FAILED', { field: 'cursor' });
      }
    }
    const rows = (
      await pool.query(
        `${taskSelect} WHERE t.workspace_id=$2 AND t.deleted_at IS NULL AND can_read_task($1,t.id)
         AND ($3::uuid IS NULL OR t.board_id=$3)
         AND ($4::text IS NULL OR strpos(lower(t.title),lower($4))>0)
         AND ($5::text IS NULL OR t.state_group=$5)
         AND ($6::uuid IS NULL OR t.responsible_id=$6)
         AND ($7::uuid IS NULL OR t.id>$7) ORDER BY t.id LIMIT $8`,
        [
          req.actor.id,
          workspaceId,
          query.boardId ?? null,
          query.q ?? null,
          query.stateGroup ?? null,
          query.responsibleUserId ?? null,
          after,
          query.limit + 1,
        ],
      )
    ).rows;
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return {
      items,
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({ version: 1, after: items[items.length - 1].id, filter }),
          ).toString('base64url')
        : null,
    };
  });
  app.get(`${prefix}/tasks/:taskId`, async (req) => {
    withoutQuery(req);
    const { taskId } = z.object({ taskId: uuid }).strict().parse(req.params);
    await scopedTask(req, taskId);
    const task = await getTask(pool, req.actor.id, taskId);
    if (!task) throw new AppError('NOT_FOUND');
    return task;
  });
  app.post(`${prefix}/boards/:boardId/tasks`, async (req, reply) => {
    requireAgentWrite(req);
    withoutQuery(req);
    const { boardId } = z.object({ boardId: uuid }).strict().parse(req.params);
    const body = createBody.parse(req.body);
    const workspaceId = authorization(req).workspaceId;
    const requestHash = createHash('sha256').update(canonicalJson({ boardId, body })).digest('hex');
    const task = await transaction(req.actor.id, async (db) => {
      await scopedBoard(req, boardId, db);
      // Match create_task's lock order so browser and Agent retries serialize together.
      await db.query('SELECT lock_workspace($1)', [workspaceId]);
      await db.query('SELECT lock_board($1)', [boardId]);
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('task-client:'||$1::text||':'||$2::text,0))",
        [req.actor.id, body.clientMutationId],
      );
      const previous = (
        await db.query(
          'SELECT * FROM agent_task_creation WHERE user_id=$1 AND client_mutation_id=$2',
          [req.actor.id, body.clientMutationId],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.request_hash !== requestHash ||
          previous.board_id !== boardId ||
          previous.workspace_id !== workspaceId
        )
          throw new AppError('DEPENDENCY_CONFLICT', { field: 'clientMutationId' });
        const existing = await getTask(db, req.actor.id, previous.task_id);
        if (!existing) throw new AppError('NOT_FOUND');
        return existing;
      }
      // Do not claim mutation IDs created through the browser or another API.
      // Their original request cannot be verified against this request's digest.
      if (
        (
          await db.query('SELECT 1 FROM task WHERE reporter_id=$1 AND client_mutation_id=$2', [
            req.actor.id,
            body.clientMutationId,
          ])
        ).rowCount
      )
        throw new AppError('DEPENDENCY_CONFLICT', { field: 'clientMutationId' });
      const result = (await db.query('SELECT * FROM create_task($1,$2)', [boardId, body])).rows[0];
      // create_task deduplicates by human reporter and mutation ID across boards.
      // A reused ID must never disclose a task from another grant or board.
      if (result.board_id !== boardId || result.workspace_id !== workspaceId)
        throw new AppError('DEPENDENCY_CONFLICT', { field: 'clientMutationId' });
      await db.query(
        'INSERT INTO agent_task_creation(user_id,client_mutation_id,workspace_id,board_id,task_id,request_hash) VALUES($1,$2,$3,$4,$5,$6)',
        [req.actor.id, body.clientMutationId, workspaceId, boardId, result.id, requestHash],
      );
      const created = await getTask(db, req.actor.id, result.id);
      if (!created) throw new AppError('NOT_FOUND');
      return created;
    });
    return reply.code(201).send(task);
  });
  app.patch(`${prefix}/tasks/:taskId`, async (req) => {
    requireAgentWrite(req);
    withoutQuery(req);
    const { taskId } = z.object({ taskId: uuid }).strict().parse(req.params);
    const body = updateBody.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await scopedTask(req, taskId, db);
      if ('parentId' in body)
        await db.query('SELECT set_task_parent($1,$2,$3,$4)', [
          taskId,
          body.parentId,
          body.expectedVersion,
          body,
        ]);
      else await db.query('SELECT mutate_task($1,$2,$3)', [taskId, body.expectedVersion, body]);
      return getTask(db, req.actor.id, taskId);
    });
  });
  app.delete(`${prefix}/tasks/:taskId`, async (req) => {
    requireAgentWrite(req);
    withoutQuery(req);
    const { taskId } = z.object({ taskId: uuid }).strict().parse(req.params);
    const { expectedVersion } = versionBody.strict().parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await scopedTask(req, taskId, db);
      const task = (
        await db.query('SELECT * FROM mutate_task($1,$2,\'{"delete":true}\')', [
          taskId,
          expectedVersion,
        ])
      ).rows[0];
      return { id: taskId, version: task.version, deleted: true };
    });
  });
}
