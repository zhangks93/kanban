import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hoursPerDay, uuid, versionBody, workLogSchema } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';

const params = z.object({ taskId: uuid, logId: uuid });
export async function registerWorkLogs(app: FastifyInstance) {
  app.get('/api/tasks/:taskId/work-logs', async (req) => {
    const tid = uuid.parse((req.params as any).taskId);
    const page = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT require_task_read($1)', [tid]);
      const summary = (
        await db.query(
          'SELECT count(*)::integer AS total,coalesce(sum(hours),0)::integer AS "totalHours" FROM task_work_log WHERE task_id=$1',
          [tid],
        )
      ).rows[0];
      const entries = (
        await db.query(
          `SELECT l.*,l.work_date::text,u.display_name AS user_name FROM task_work_log l
         JOIN app_user u ON u.id=l.user_id WHERE l.task_id=$1
         ORDER BY l.work_date DESC,l.created_at DESC,l.id LIMIT 50 OFFSET $2`,
          [tid, page.offset],
        )
      ).rows;
      return { ...summary, entries };
    });
  });
  app.post('/api/tasks/:taskId/work-logs', async (req, reply) => {
    const tid = uuid.parse((req.params as any).taskId);
    const body = workLogSchema.extend({ clientMutationId: uuid }).parse(req.body);
    return reply
      .code(201)
      .send(
        await transaction(
          req.actor.id,
          async (db) =>
            (await db.query('SELECT * FROM create_work_log($1,$2)', [tid, body])).rows[0],
        ),
      );
  });
  app.patch('/api/tasks/:taskId/work-logs/:logId', async (req) => {
    const p = params.parse(req.params);
    const body = workLogSchema.merge(versionBody).parse(req.body);
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT * FROM mutate_work_log($1,$2,$3,$4)', [
            p.taskId,
            p.logId,
            body.expectedVersion,
            body,
          ])
        ).rows[0],
    );
  });
  app.delete('/api/tasks/:taskId/work-logs/:logId', async (req) => {
    const p = params.parse(req.params);
    const body = versionBody.parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query("SELECT mutate_work_log($1,$2,$3,'{}',true)", [
        p.taskId,
        p.logId,
        body.expectedVersion,
      ]);
      return { ok: true };
    });
  });
  app.get('/api/work-logs/report', async (req) => {
    const filter = z
      .object({
        workspaceId: uuid.optional(),
        userId: uuid.optional(),
        taskId: uuid.optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .refine((v) => !v.from || !v.to || v.from <= v.to)
      .parse(req.query);
    if (
      filter.workspaceId &&
      !(
        await pool.query('SELECT workspace_role($1,$2) IS NOT NULL AS ok', [
          req.actor.id,
          filter.workspaceId,
        ])
      ).rows[0].ok
    )
      throw new AppError('NOT_FOUND');
    const report = (
      await pool.query(
        `
      WITH filtered AS (
        SELECT l.*,u.display_name,t.title,t.seq,t.estimate_days,b.key AS board_key,w.key AS workspace_key
        FROM task_work_log l JOIN task t ON t.id=l.task_id JOIN app_user u ON u.id=l.user_id
        JOIN board b ON b.id=t.board_id JOIN workspace w ON w.id=t.workspace_id
        WHERE can_read_task($1,t.id)
          AND ($2::uuid IS NULL OR l.workspace_id=$2) AND ($3::uuid IS NULL OR l.user_id=$3)
          AND ($4::uuid IS NULL OR l.task_id=$4) AND ($5::date IS NULL OR l.work_date>=$5)
          AND ($6::date IS NULL OR l.work_date<=$6)
      )
      SELECT coalesce(sum(hours),0)::integer AS "totalHours",count(*)::integer AS "totalEntries",
        coalesce((SELECT jsonb_agg(x ORDER BY x."userName",x."userId") FROM (
          SELECT user_id AS "userId",display_name AS "userName",sum(hours)::integer AS hours
          FROM filtered GROUP BY user_id,display_name) x),'[]') AS "byUser",
        coalesce((SELECT jsonb_agg(x ORDER BY x."workDate" DESC) FROM (
          SELECT work_date::text AS "workDate",sum(hours)::integer AS hours FROM filtered GROUP BY work_date) x),'[]') AS "byDate",
        coalesce((SELECT jsonb_agg(x ORDER BY x."boardKey",x.seq) FROM (
          SELECT task_id AS "taskId",title,seq,board_key AS "boardKey",workspace_key AS "workspaceKey",
            estimate_days AS "estimateDays",sum(hours)::integer AS hours,
            (SELECT sum(all_logs.hours)::integer FROM task_work_log all_logs WHERE all_logs.task_id=f.task_id) AS "totalTaskHours"
          FROM filtered f GROUP BY task_id,title,seq,board_key,workspace_key,estimate_days) x),'[]') AS "byTask"
      FROM filtered`,
        [req.actor.id, filter.workspaceId, filter.userId, filter.taskId, filter.from, filter.to],
      )
    ).rows[0];
    return { ...report, hoursPerDay };
  });
}
