import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { coreTemplates, type BoardTemplateDefinition } from '@work/plugin-sdk';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
export async function manageBoard<T>(
  actor: string,
  bid: string,
  fn: (db: pg.PoolClient) => Promise<T>,
) {
  return transaction(actor, async (db) => {
    const b = (await db.query('SELECT workspace_id FROM board WHERE id=$1', [bid])).rows[0];
    if (!b) throw new AppError('NOT_FOUND');
    await db.query('SELECT lock_workspace($1)', [b.workspace_id]);
    await db.query('SELECT lock_board($1,true)', [bid]);
    await db.query('SELECT require_board_manage($1)', [bid]);
    return fn(db);
  });
}
export async function registerBoards(
  app: FastifyInstance,
  templates: BoardTemplateDefinition[] = coreTemplates,
) {
  app.get('/api/boards/:boardId/workers', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    if (!(await pool.query('SELECT can_read_board($1,$2) ok', [req.actor.id, bid])).rows[0].ok)
      throw new AppError('NOT_FOUND');
    return (
      await pool.query(
        'SELECT u.id AS "userId",u.display_name AS "displayName",u.avatar_url AS "avatarUrl",bm.role AS "boardRole",wip_usage(u.id) AS "usedWip",u.wip_limit AS "wipLimit" FROM app_user u LEFT JOIN board_member bm ON bm.user_id=u.id AND bm.board_id=$1 WHERE is_worker_eligible(u.id,$1) ORDER BY u.display_name',
        [bid],
      )
    ).rows;
  });
  app.get('/api/workspaces/:workspaceId/templates', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    if (
      !(await pool.query('SELECT workspace_role($1,$2) AS role', [req.actor.id, wid])).rows[0].role
    )
      throw new AppError('NOT_FOUND');
    const enabled = (
      await pool.query('SELECT plugin_key FROM workspace_plugin WHERE workspace_id=$1', [wid])
    ).rows.map((r) => r.plugin_key);
    return templates.filter((t) => !t.pluginKey || enabled.includes(t.pluginKey));
  });
  app.get(
    '/api/workspaces/:workspaceId/boards',
    async (req) =>
      (
        await pool.query(
          'SELECT b.*,can_manage_board($1,b.id) AS can_manage FROM board b WHERE workspace_id=$2 AND can_read_board($1,b.id) ORDER BY name',
          [req.actor.id, uuid.parse((req.params as any).workspaceId)],
        )
      ).rows,
  );
  app.post('/api/workspaces/:workspaceId/boards', async (req, reply) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        key: z.string().regex(/^[A-Z][A-Z0-9_-]{1,20}$/),
        templateKey: z.string(),
        accessMode: z.enum(['workspace', 'restricted']),
      })
      .parse(req.body);
    const template = templates.find((t) => t.key === b.templateKey);
    if (!template) throw new AppError('VALIDATION_FAILED');
    return reply
      .code(201)
      .send(
        await transaction(
          req.actor.id,
          async (db) =>
            (
              await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
                wid,
                b.key,
                b.name,
                b.accessMode,
                template,
              ])
            ).rows[0],
        ),
      );
  });
  app.get('/api/boards/:boardId', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    const board = (
      await pool.query(
        'SELECT b.*,can_manage_board($1,b.id) AS can_manage FROM board b WHERE id=$2 AND can_read_board($1,b.id)',
        [req.actor.id, bid],
      )
    ).rows[0];
    if (!board) throw new AppError('NOT_FOUND');
    const [states, lanes, types, milestones, labels] = await Promise.all(
      ['board_state', 'board_lane', 'board_task_type', 'milestone', 'label'].map((table) =>
        pool.query(
          `SELECT * FROM ${table} WHERE board_id=$1 ORDER BY ${['board_state', 'board_lane', 'board_task_type'].includes(table) ? 'sort_order' : 'name'}`,
          [bid],
        ),
      ),
    );
    return {
      board,
      states: states.rows,
      lanes: lanes.rows,
      types: types.rows,
      milestones: milestones.rows,
      labels: labels.rows,
    };
  });
  app.patch('/api/boards/:boardId', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().nullable().optional(),
        accessMode: z.enum(['workspace', 'restricted']).optional(),
        intakeEnabled: z.boolean().optional(),
      })
      .parse(req.body);
    return manageBoard(
      req.actor.id,
      bid,
      async (db) =>
        (
          await db.query(
            'UPDATE board SET name=coalesce($2,name),description=CASE WHEN $3 THEN $4 ELSE description END,access_mode=coalesce($5,access_mode),intake_enabled=coalesce($6,intake_enabled),updated_at=now() WHERE id=$1 RETURNING *',
            [bid, b.name, 'description' in b, b.description, b.accessMode, b.intakeEnabled],
          )
        ).rows[0],
    );
  });
  app.post('/api/boards/:boardId/archive', async (req) =>
    manageBoard(
      req.actor.id,
      uuid.parse((req.params as any).boardId),
      async (db) =>
        (
          await db.query("UPDATE board SET status='archived' WHERE id=$1 RETURNING *", [
            (req.params as any).boardId,
          ])
        ).rows[0],
    ),
  );
  app.get('/api/boards/:boardId/members', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    if (!(await pool.query('SELECT can_read_board($1,$2) AS ok', [req.actor.id, bid])).rows[0].ok)
      throw new AppError('NOT_FOUND');
    return (
      await pool.query(
        'SELECT bm.*,u.display_name FROM board_member bm JOIN app_user u ON u.id=bm.user_id WHERE board_id=$1 ORDER BY u.display_name',
        [bid],
      )
    ).rows;
  });
  app.post('/api/boards/:boardId/members', async (req) => {
    const b = z
      .object({ userId: uuid, role: z.enum(['lead', 'member', 'viewer']) })
      .parse(req.body);
    return manageBoard(
      req.actor.id,
      uuid.parse((req.params as any).boardId),
      async (db) =>
        (
          await db.query(
            'INSERT INTO board_member(board_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(board_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING *',
            [(req.params as any).boardId, b.userId, b.role],
          )
        ).rows[0],
    );
  });
  app.patch('/api/boards/:boardId/members/:userId', async (req) => {
    const p = z.object({ boardId: uuid, userId: uuid }).parse(req.params);
    const b = z.object({ role: z.enum(['lead', 'member', 'viewer']) }).parse(req.body);
    return manageBoard(
      req.actor.id,
      p.boardId,
      async (db) =>
        (
          await db.query(
            'UPDATE board_member SET role=$3 WHERE board_id=$1 AND user_id=$2 RETURNING *',
            [p.boardId, p.userId, b.role],
          )
        ).rows[0],
    );
  });
  app.delete('/api/boards/:boardId/members/:userId', async (req) => {
    const p = z.object({ boardId: uuid, userId: uuid }).parse(req.params);
    return manageBoard(req.actor.id, p.boardId, async (db) => {
      const before = (
        await db.query('DELETE FROM board_member WHERE board_id=$1 AND user_id=$2 RETURNING *', [
          p.boardId,
          p.userId,
        ])
      ).rows[0];
      await db.query(
        "INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,before) SELECT workspace_id,$2,'board.member.remove','user',$3,$4 FROM board WHERE id=$1",
        [p.boardId, req.actor.id, p.userId, before],
      );
      return { ok: true };
    });
  });
  app.patch('/api/boards/:boardId/states/:stateId', async (req) => {
    const p = z.object({ boardId: uuid, stateId: uuid }).parse(req.params);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    return manageBoard(
      req.actor.id,
      p.boardId,
      async (db) =>
        (
          await db.query(
            'UPDATE board_state SET name=coalesce($3,name),sort_order=coalesce($4,sort_order) WHERE id=$2 AND board_id=$1 RETURNING *',
            [p.boardId, p.stateId, b.name, b.sortOrder],
          )
        ).rows[0],
    );
  });
  app.get('/api/boards/:boardId/lanes', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    if (!(await pool.query('SELECT can_read_board($1,$2) ok', [req.actor.id, bid])).rows[0].ok)
      throw new AppError('NOT_FOUND');
    return (
      await pool.query('SELECT * FROM board_lane WHERE board_id=$1 ORDER BY sort_order', [bid])
    ).rows;
  });
  app.post('/api/boards/:boardId/lanes', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        key: z.string().min(1).max(50).optional(),
      })
      .parse(req.body);
    return manageBoard(req.actor.id, bid, async (db) => {
      if (
        (await db.query('SELECT lane_mode FROM board WHERE id=$1', [bid])).rows[0].lane_mode !==
        'manual'
      )
        throw new AppError('LANE_NOT_ALLOWED');
      return (
        await db.query(
          'INSERT INTO board_lane(board_id,key,name,sort_order) VALUES($1,$2,$3,(SELECT coalesce(max(sort_order),0)+1 FROM board_lane WHERE board_id=$1)) RETURNING *',
          [bid, b.key ?? crypto.randomUUID(), b.name],
        )
      ).rows[0];
    });
  });
  app.patch('/api/boards/:boardId/lanes/:laneId', async (req) => {
    const p = z.object({ boardId: uuid, laneId: uuid }).parse(req.params);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    return manageBoard(
      req.actor.id,
      p.boardId,
      async (db) =>
        (
          await db.query(
            'UPDATE board_lane SET name=coalesce($3,name),description=CASE WHEN $4 THEN $5 ELSE description END,sort_order=coalesce($6,sort_order) WHERE board_id=$1 AND id=$2 RETURNING *',
            [p.boardId, p.laneId, b.name, 'description' in b, b.description, b.sortOrder],
          )
        ).rows[0],
    );
  });
  app.post('/api/boards/:boardId/lanes/:laneId/archive', async (req) => {
    const p = z.object({ boardId: uuid, laneId: uuid }).parse(req.params);
    return manageBoard(req.actor.id, p.boardId, async (db) => {
      const count = Number(
        (
          await db.query(
            "SELECT count(*) FROM task WHERE lane_id=$1 AND deleted_at IS NULL AND state_group NOT IN('completed','cancelled')",
            [p.laneId],
          )
        ).rows[0].count,
      );
      if (count) throw new AppError('LANE_HAS_ACTIVE_TASKS', { activeTaskCount: count });
      return (
        await db.query(
          "UPDATE board_lane SET status='archived' WHERE id=$1 AND board_id=$2 RETURNING *",
          [p.laneId, p.boardId],
        )
      ).rows[0];
    });
  });
  for (const table of ['label', 'milestone'] as const) {
    app.post(`/api/boards/:boardId/${table === 'label' ? 'labels' : 'milestones'}`, async (req) => {
      const bid = uuid.parse((req.params as any).boardId);
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          color: z
            .string()
            .regex(/^#[a-fA-F0-9]{6}$/)
            .optional(),
          dueDate: z.string().date().optional(),
        })
        .parse(req.body);
      return manageBoard(req.actor.id, bid, async (db) => {
        if (table === 'milestone' && !b.dueDate) throw new AppError('VALIDATION_FAILED');
        return (
          await db.query(
            table === 'label'
              ? 'INSERT INTO label(board_id,name,color) VALUES($1,$2,$3) RETURNING *'
              : 'INSERT INTO milestone(board_id,name,due_date) VALUES($1,$2,$3) RETURNING *',
            [bid, b.name, table === 'label' ? b.color : b.dueDate],
          )
        ).rows[0];
      });
    });
  }
}
