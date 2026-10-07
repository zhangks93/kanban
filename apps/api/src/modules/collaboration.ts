import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { transaction } from '../lib/db';
import { AppError } from '../lib/errors';
export async function registerCollaboration(app: FastifyInstance) {
  for (const kind of ['comments', 'resources'] as const) {
    const table = kind === 'comments' ? 'comment' : 'resource_link';
    app.get(`/api/tasks/:taskId/${kind}`, async (req) => {
      const tid = uuid.parse((req.params as any).taskId);
      return transaction(req.actor.id, async (db) => {
        await db.query('SELECT require_task_read($1)', [tid]);
        return (
          await db.query(
            `SELECT c.*,u.display_name AS author_name FROM ${table} c JOIN app_user u ON u.id=c.${kind === 'comments' ? 'author_id' : 'created_by'} WHERE task_id=$1 ${kind === 'comments' ? 'AND deleted_at IS NULL' : ''} ORDER BY c.created_at`,
            [tid],
          )
        ).rows;
      });
    });
    app.post(`/api/tasks/:taskId/${kind}`, async (req, reply) => {
      const tid = uuid.parse((req.params as any).taskId);
      const b = (
        kind === 'comments'
          ? z.object({ body: z.record(z.unknown()) })
          : z.object({
              title: z.string().trim().min(1).max(255),
              url: z
                .string()
                .url()
                .refine((u) => ['https:', 'http:'].includes(new URL(u).protocol)),
              kind: z.string().min(1).max(30).default('link'),
            })
      ).parse(req.body) as any;
      return reply.code(201).send(
        await transaction(req.actor.id, async (db) => {
          await db.query('SELECT lock_task_scope($1),require_task_read($1)', [tid]);
          if (!(await db.query('SELECT can_edit_task($1,$2) ok', [req.actor.id, tid])).rows[0].ok)
            throw new AppError('FORBIDDEN');
          const t = (await db.query('SELECT * FROM task WHERE id=$1', [tid])).rows[0];
          const row = (
            await db.query(
              kind === 'comments'
                ? 'INSERT INTO comment(workspace_id,board_id,task_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING *'
                : 'INSERT INTO resource_link(workspace_id,board_id,task_id,created_by,title,url,kind) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
              [
                t.workspace_id,
                t.board_id,
                tid,
                req.actor.id,
                ...(kind === 'comments' ? [b.body] : [b.title, b.url, b.kind]),
              ],
            )
          ).rows[0];
          await db.query(
            'INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action) VALUES($1,$2,$3,$4,$5)',
            [
              t.workspace_id,
              t.board_id,
              tid,
              req.actor.id,
              kind === 'comments' ? 'comment.add' : 'resource.add',
            ],
          );
          return row;
        }),
      );
    });
  }
  app.patch('/api/comments/:commentId', async (req) => {
    const cid = uuid.parse((req.params as any).commentId);
    const b = z.object({ body: z.record(z.unknown()) }).parse(req.body);
    return transaction(req.actor.id, async (db) => {
      const c = (await db.query('SELECT * FROM comment WHERE id=$1 AND deleted_at IS NULL', [cid]))
        .rows[0];
      if (!c) throw new AppError('NOT_FOUND');
      await db.query('SELECT lock_task_scope($1),require_task_read($1)', [c.task_id]);
      if (
        c.author_id !== req.actor.id ||
        !(await db.query('SELECT can_edit_task($1,$2) ok', [req.actor.id, c.task_id])).rows[0].ok
      )
        throw new AppError('FORBIDDEN');
      return (
        await db.query(
          'UPDATE comment SET body=$2,edited_at=now(),updated_at=now() WHERE id=$1 RETURNING *',
          [cid, b.body],
        )
      ).rows[0];
    });
  });
  for (const kind of ['comments', 'resources'] as const) {
    app.delete(`/api/${kind}/:entityId`, async (req) => {
      const id = uuid.parse((req.params as any).entityId);
      return transaction(req.actor.id, async (db) => {
        const c = (
          await db.query(
            `SELECT * FROM ${kind === 'comments' ? 'comment' : 'resource_link'} WHERE id=$1`,
            [id],
          )
        ).rows[0];
        if (!c) throw new AppError('NOT_FOUND');
        await db.query('SELECT lock_task_scope($1),require_task_read($1)', [c.task_id]);
        if (
          !(await db.query('SELECT can_edit_task($1,$2) ok', [req.actor.id, c.task_id])).rows[0].ok
        )
          throw new AppError('FORBIDDEN');
        if (
          c[kind === 'comments' ? 'author_id' : 'created_by'] !== req.actor.id &&
          !(await db.query('SELECT can_manage_board($1,$2) ok', [req.actor.id, c.board_id])).rows[0]
            .ok
        )
          throw new AppError('FORBIDDEN');
        await db.query(
          kind === 'comments'
            ? 'UPDATE comment SET deleted_at=now() WHERE id=$1'
            : 'DELETE FROM resource_link WHERE id=$1',
          [id],
        );
        return { ok: true };
      });
    });
  }
}
