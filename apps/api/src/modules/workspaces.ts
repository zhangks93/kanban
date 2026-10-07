import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
const member = z.object({
  userId: uuid,
  role: z.enum(['owner', 'admin', 'member']),
  status: z.enum(['active', 'inactive']).default('active'),
});
export async function registerWorkspaces(app: FastifyInstance) {
  app.get(
    '/api/workspaces',
    async (req) =>
      (
        await pool.query(
          "SELECT w.*,m.role FROM workspace w JOIN workspace_member m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.status='active' AND w.status='active' ORDER BY w.name",
          [req.actor.id],
        )
      ).rows,
  );
  app.post('/api/workspaces', async (req, reply) => {
    const b = z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(2000).optional(),
      })
      .parse(req.body);
    const result = await transaction(
      req.actor.id,
      async (db) =>
        (await db.query('SELECT * FROM create_workspace($1,$2,$3)', [b.key, b.name, b.description]))
          .rows[0],
    );
    return reply.status(201).send(result);
  });
  app.get('/api/workspaces/:workspaceId', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    const result = (
      await pool.query(
        'SELECT w.*,workspace_role($1,w.id) AS role FROM workspace w WHERE id=$2 AND workspace_role($1,w.id) IS NOT NULL',
        [req.actor.id, wid],
      )
    ).rows[0];
    if (!result) throw new AppError('NOT_FOUND');
    return result;
  });
  app.patch('/api/workspaces/:workspaceId', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(['active', 'archived']).optional(),
      })
      .parse(req.body);
    return transaction(req.actor.id, async (db) => {
      await db.query('SELECT lock_workspace($1,true)', [wid]);
      const allowed = (
        await db.query('SELECT can_manage_workspace($1,$2) AS ok', [req.actor.id, wid])
      ).rows[0].ok;
      if (!allowed) throw new AppError('FORBIDDEN');
      if (b.status === 'archived' && !req.actor.is_platform_admin) throw new AppError('FORBIDDEN');
      return (
        await db.query(
          'UPDATE workspace SET name=coalesce($2,name),description=CASE WHEN $3 THEN $4 ELSE description END,status=coalesce($5,status),updated_at=now() WHERE id=$1 RETURNING *',
          [wid, b.name, 'description' in b, b.description, b.status],
        )
      ).rows[0];
    });
  });
  app.get('/api/workspaces/:workspaceId/members', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    if (!(await pool.query('SELECT workspace_role($1,$2) role', [req.actor.id, wid])).rows[0].role)
      throw new AppError('NOT_FOUND');
    return (
      await pool.query(
        'SELECT u.id,u.display_name,u.status AS account_status,u.wip_limit,m.role,m.status FROM workspace_member m JOIN app_user u ON u.id=m.user_id WHERE workspace_id=$1 ORDER BY u.display_name',
        [wid],
      )
    ).rows;
  });
  app.post('/api/workspaces/:workspaceId/members', async (req) => {
    const b = member.parse(req.body);
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT * FROM set_workspace_member($1,$2,$3,$4)', [
            uuid.parse((req.params as any).workspaceId),
            b.userId,
            b.role,
            b.status,
          ])
        ).rows[0],
    );
  });
  app.patch('/api/workspaces/:workspaceId/members/:userId', async (req) => {
    const p = z.object({ workspaceId: uuid, userId: uuid }).parse(req.params);
    const b = member.omit({ userId: true }).parse(req.body);
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT * FROM set_workspace_member($1,$2,$3,$4)', [
            p.workspaceId,
            p.userId,
            b.role,
            b.status,
          ])
        ).rows[0],
    );
  });
  app.get('/api/admin/users', async (req) => {
    if (!req.actor.is_platform_admin) throw new AppError('FORBIDDEN');
    return (
      await pool.query(
        'SELECT id,display_name,status,is_platform_admin,wip_limit FROM app_user ORDER BY display_name',
      )
    ).rows;
  });
  app.patch('/api/admin/users/:userId/status', async (req) => {
    const b = z.object({ status: z.enum(['active', 'deactivated']) }).parse(req.body);
    return transaction(
      req.actor.id,
      async (db) =>
        (
          await db.query('SELECT * FROM set_user_status($1,$2)', [
            uuid.parse((req.params as any).userId),
            b.status,
          ])
        ).rows[0],
    );
  });
  app.get('/api/admin/audit', async (req) => {
    if (!req.actor.is_platform_admin) throw new AppError('FORBIDDEN');
    return (await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')).rows;
  });
}
