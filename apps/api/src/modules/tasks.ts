import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid, versionBody } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
import { getTask, listTasks } from '../repositories/tasks';
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
  sortKey: z.string().min(1).max(100).optional(),
});
const patch = properties.merge(versionBody);
const move = properties
  .pick({ stateId: true, laneId: true, responsibleUserId: true, sortKey: true })
  .merge(versionBody)
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'));
export async function registerTasks(app: FastifyInstance) {
  app.get('/api/boards/:boardId/tasks', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    if (!(await pool.query('SELECT can_read_board($1,$2) ok', [req.actor.id, bid])).rows[0].ok)
      throw new AppError('NOT_FOUND');
    const query = z
      .object({ participant: uuid.optional(), q: z.string().max(200).optional() })
      .parse(req.query);
    return listTasks(
      pool,
      req.actor.id,
      't.board_id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM task_participant p WHERE p.task_id=t.id AND p.user_id=$3)) AND ($4::text IS NULL OR t.title ILIKE $4)',
      [bid, query.participant, query.q ? `%${query.q}%` : null],
    );
  });
  app.post('/api/boards/:boardId/tasks', async (req, reply) => {
    const bid = uuid.parse((req.params as any).boardId);
    const b = properties
      .extend({
        title: z.string().trim().min(1).max(255),
        responsibleUserId: uuid,
        participantUserIds: z.array(uuid).max(200).optional(),
        requesterId: uuid.optional(),
        clientMutationId: uuid.optional(),
      })
      .parse(req.body);
    return reply.code(201).send(
      await transaction(req.actor.id, async (db) => {
        const t = (await db.query('SELECT * FROM create_task($1,$2)', [bid, b])).rows[0];
        return getTask(db, req.actor.id, t.id);
      }),
    );
  });
  app.get('/api/boards/:boardId/tasks/:seq', async (req) => {
    const p = z
      .object({ boardId: uuid, seq: z.coerce.number().int().positive() })
      .parse(req.params);
    const row = (
      await pool.query(
        'SELECT id FROM task WHERE board_id=$1 AND seq=$2 AND can_read_task($3,id)',
        [p.boardId, p.seq, req.actor.id],
      )
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    return getTask(pool, req.actor.id, row.id);
  });
  app.get('/api/tasks/:taskId', async (req) => {
    const t = await getTask(pool, req.actor.id, uuid.parse((req.params as any).taskId));
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  });
  app.patch('/api/tasks/:taskId', async (req) => {
    const b = patch.parse(req.body);
    const tid = uuid.parse((req.params as any).taskId);
    return transaction(req.actor.id, async (db) => {
      if ('parentId' in b)
        await db.query('SELECT set_task_parent($1,$2,$3,$4)', [
          tid,
          b.parentId,
          b.expectedVersion,
          b,
        ]);
      else await db.query('SELECT mutate_task($1,$2,$3)', [tid, b.expectedVersion, b]);
      return getTask(db, req.actor.id, tid);
    });
  });
  app.delete('/api/tasks/:taskId', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = versionBody.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      const t = (
        await db.query('SELECT * FROM mutate_task($1,$2,\'{"delete":true}\')', [
          tid,
          b.expectedVersion,
        ])
      ).rows[0];
      return { id: tid, version: t.version, deleted: true };
    });
  });
  app.post('/api/tasks/:taskId/move', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = move.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT move_task($1,$2,$3)', [tid, b.expectedVersion, b]);
      return getTask(db, req.actor.id, tid);
    });
  });
  for (const [endpoint, field, schema] of [
    ['transition', 'stateId', uuid],
    ['responsible', 'responsibleUserId', uuid],
    ['move-lane', 'laneId', uuid.nullable()],
  ] as const) {
    app.post(`/api/tasks/:taskId/${endpoint}`, async (req) => {
      const tid = uuid.parse((req.params as any).taskId);
      const data = versionBody
        .extend({ [endpoint === 'responsible' ? 'userId' : field]: schema })
        .parse(req.body) as any;
      return transaction(req.actor.id, async (db) => {
        await db.query('SELECT move_task($1,$2,$3)', [
          tid,
          data.expectedVersion,
          { [field]: data[endpoint === 'responsible' ? 'userId' : field] },
        ]);
        return getTask(db, req.actor.id, tid);
      });
    });
  }
  app.post('/api/tasks/:taskId/reorder', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = z.object({ sortKey: z.string().min(1).max(100) }).parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT reorder_task($1,$2)', [tid, b.sortKey]);
      return getTask(db, req.actor.id, tid);
    });
  });
  app.post('/api/tasks/:taskId/participants', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = versionBody.extend({ userId: uuid }).parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT add_task_participant($1,$2,$3)', [tid, b.userId, b.expectedVersion]);
      return getTask(db, req.actor.id, tid);
    });
  });
  app.post('/api/tasks/:taskId/participants/:userId/remove', async (req) => {
    const p = z.object({ taskId: uuid, userId: uuid }).parse(req.params);
    const b = versionBody.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT remove_task_participant($1,$2,$3)', [
        p.taskId,
        p.userId,
        b.expectedVersion,
      ]);
      return getTask(db, req.actor.id, p.taskId);
    });
  });
  app.post('/api/tasks/:taskId/labels', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = versionBody.extend({ labelId: uuid }).parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT set_task_label($1,$2,$3,true)', [tid, b.labelId, b.expectedVersion]);
      return getTask(db, req.actor.id, tid);
    });
  });
  app.post('/api/tasks/:taskId/labels/:labelId/remove', async (req) => {
    const p = z.object({ taskId: uuid, labelId: uuid }).parse(req.params);
    const b = versionBody.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT set_task_label($1,$2,$3,false)', [
        p.taskId,
        p.labelId,
        b.expectedVersion,
      ]);
      return getTask(db, req.actor.id, p.taskId);
    });
  });
  app.get('/api/tasks/:taskId/children', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT require_task_read($1)', [tid]);
      return listTasks(db, req.actor.id, 't.parent_id=$2', [tid]);
    });
  });
  app.get('/api/tasks/:taskId/activity', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT require_task_read($1)', [tid]);
      return (
        await db.query(
          'SELECT a.*,u.display_name AS actor_name FROM task_activity a LEFT JOIN app_user u ON u.id=a.actor_id WHERE task_id=$1 ORDER BY a.id DESC LIMIT 100',
          [tid],
        )
      ).rows;
    });
  });
}
