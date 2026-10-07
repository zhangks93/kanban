import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { listTasks } from '../repositories/tasks';
export async function registerFocus(app: FastifyInstance) {
  app.post('/api/tasks/:taskId/focus', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const b = z.object({ replaceTaskId: uuid.optional() }).parse(req.body ?? {});
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT focus_task($1,$2,$3) AS result', [
            req.actor.id,
            tid,
            b.replaceTaskId,
          ])
        ).rows[0].result,
    );
  });
  app.delete('/api/tasks/:taskId/focus', async (req) =>
    transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT unfocus_task($1,$2) AS result', [
            req.actor.id,
            uuid.parse((req.params as any).taskId),
          ])
        ).rows[0].result,
    ),
  );
  app.get('/api/me/focus', async (req) =>
    listTasks(
      pool,
      req.actor.id,
      'EXISTS(SELECT 1 FROM task_focus f WHERE f.task_id=t.id AND f.user_id=$1)',
    ),
  );
  app.get('/api/me/tasks', async (req) => {
    const tasks = await listTasks(pool, req.actor.id, 'is_task_worker($1,t.id)');
    return tasks.map((t) => ({
      ...t,
      relation: t.responsible_id === req.actor.id ? 'responsible' : 'participant',
    }));
  });
  app.patch('/api/admin/users/:userId/wip-limit', async (req) => {
    const b = z.object({ wipLimit: z.number().int().min(1).max(10) }).parse(req.body);
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT * FROM set_wip_limit($1,$2)', [
            uuid.parse((req.params as any).userId),
            b.wipLimit,
          ])
        ).rows[0],
    );
  });
}
