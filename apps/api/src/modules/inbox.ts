import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
import { listTasks } from '../repositories/tasks';
export async function registerInbox(app: FastifyInstance) {
  app.get('/api/workspaces/:workspaceId/search', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    if (!(await pool.query('SELECT workspace_role($1,$2) role', [req.actor.id, wid])).rows[0].role)
      throw new AppError('NOT_FOUND');
    return listTasks(
      pool,
      req.actor.id,
      "t.workspace_id=$2 AND (t.title ILIKE $3 OR t.description_text ILIKE $3 OR (b.key||'-'||t.seq::text) ILIKE $3)",
      [wid, `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`],
    );
  });
  app.get(
    '/api/me/notifications',
    async (req) =>
      (
        await pool.query(
          "SELECT n.id,n.type,n.read_at,n.created_at,t.id AS task_id,t.title,b.key AS board_key,t.seq,w.key AS workspace_key FROM notification n JOIN task t ON n.entity_type='task' AND t.id=n.entity_id JOIN board b ON b.id=t.board_id JOIN workspace w ON w.id=t.workspace_id WHERE n.user_id=$1 AND can_read_task($1,t.id) ORDER BY n.created_at DESC LIMIT 100",
          [req.actor.id],
        )
      ).rows,
  );
  app.post('/api/notifications/:notificationId/read', async (req) =>
    transaction(req.actor.id, async (db) => {
      await db.query('UPDATE notification SET read_at=now() WHERE id=$1 AND user_id=$2', [
        uuid.parse((req.params as any).notificationId),
        req.actor.id,
      ]);
      return { ok: true };
    }),
  );
  app.post('/api/boards/:boardId/intake', async (req, reply) => {
    const bid = uuid.parse((req.params as any).boardId);
    const b = z
      .object({
        title: z.string().trim().min(1).max(255),
        description: z.string().max(10000).optional(),
        expectedDate: z.string().date().optional(),
        clientMutationId: uuid,
      })
      .parse(req.body);
    return reply
      .code(201)
      .send(
        await transaction(
          req.actor.id,
          async (db) => (await db.query('SELECT * FROM create_intake($1,$2)', [bid, b])).rows[0],
        ),
      );
  });
  app.get('/api/boards/:boardId/intake', async (req) => {
    const bid = uuid.parse((req.params as any).boardId);
    if (!(await pool.query('SELECT can_read_board($1,$2) ok', [req.actor.id, bid])).rows[0].ok)
      throw new AppError('NOT_FOUND');
    return (
      await pool.query(
        'SELECT r.*,u.display_name AS requester_name FROM intake_request r JOIN app_user u ON u.id=r.requester_id WHERE board_id=$1 AND (requester_id=$2 OR can_manage_board($2,$1)) ORDER BY created_at DESC LIMIT 100',
        [bid, req.actor.id],
      )
    ).rows;
  });
  app.post('/api/intake/:requestId/accept', async (req) => {
    const rid = uuid.parse((req.params as any).requestId);
    const b = z
      .object({ responsibleUserId: uuid, participantUserIds: z.array(uuid).optional() })
      .parse(req.body);
    return transaction(
      req.actor.id,
      async (db) => (await db.query('SELECT * FROM decide_intake($1,true,$2)', [rid, b])).rows[0],
    );
  });
  app.post('/api/intake/:requestId/decline', async (req) => {
    const rid = uuid.parse((req.params as any).requestId);
    const b = z.object({ reason: z.string().trim().min(1).max(2000) }).parse(req.body);
    return transaction(
      req.actor.id,
      async (db) => (await db.query('SELECT * FROM decide_intake($1,false,$2)', [rid, b])).rows[0],
    );
  });
  app.get('/api/workspaces/:workspaceId/audit', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    if (
      !(await pool.query('SELECT can_manage_workspace($1,$2) ok', [req.actor.id, wid])).rows[0].ok
    )
      throw new AppError('FORBIDDEN');
    return (
      await pool.query(
        'SELECT a.*,u.display_name AS actor_name FROM audit_log a LEFT JOIN app_user u ON u.id=a.actor_id WHERE workspace_id=$1 ORDER BY id DESC LIMIT 200',
        [wid],
      )
    ).rows;
  });
}
