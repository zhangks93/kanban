import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { transaction } from '../lib/db';
import { AppError } from '../lib/errors';

const name = z.string().trim().min(1).max(100);
const workspaceParams = z.object({ workspaceId: uuid });
const recordParams = workspaceParams.extend({ id: uuid });

async function access(db: pg.PoolClient, userId: string, workspaceId: string, manage = false) {
  // Serialize permission checks with membership removal and workspace archival.
  await db.query('SELECT lock_workspace($1)', [workspaceId]);
  const role = (await db.query('SELECT workspace_role($1,$2) role', [userId, workspaceId])).rows[0]
    .role;
  if (!role) throw new AppError('NOT_FOUND');
  if (manage && !['owner', 'admin'].includes(role)) throw new AppError('FORBIDDEN');
}

export async function registerFoundationData(app: FastifyInstance) {
  app.get('/api/workspaces/:workspaceId/data', async (req) => {
    const { workspaceId } = workspaceParams.parse(req.params);
    return transaction(req.actor.id, async (db) => {
      await access(db, req.actor.id, workspaceId);
      const systems = (
        await db.query('SELECT * FROM workspace_system WHERE workspace_id=$1 ORDER BY name,id', [
          workspaceId,
        ])
      ).rows;
      const projects = (
        await db.query('SELECT * FROM workspace_project WHERE workspace_id=$1 ORDER BY name,id', [
          workspaceId,
        ])
      ).rows;
      return { systems, projects };
    });
  });

  for (const kind of ['systems', 'projects'] as const) {
    const table = kind === 'systems' ? 'workspace_system' : 'workspace_project';
    const body =
      kind === 'systems'
        ? z.object({ name }).strict()
        : z.object({ name, systemId: uuid }).strict();
    app.get(`/api/workspaces/:workspaceId/data/${kind}`, async (req) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      return transaction(req.actor.id, async (db) => {
        await access(db, req.actor.id, workspaceId);
        return (
          await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1 ORDER BY name,id`, [
            workspaceId,
          ])
        ).rows;
      });
    });
    app.post(`/api/workspaces/:workspaceId/data/${kind}`, async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const values = body.parse(req.body);
      const result = await transaction(req.actor.id, async (db) => {
        await access(db, req.actor.id, workspaceId, true);
        if (
          'systemId' in values &&
          !(
            await db.query('SELECT 1 FROM workspace_system WHERE id=$1 AND workspace_id=$2', [
              values.systemId,
              workspaceId,
            ])
          ).rowCount
        )
          throw new AppError('VALIDATION_FAILED');
        return (
          await db.query(
            kind === 'systems'
              ? 'INSERT INTO workspace_system(workspace_id,name) VALUES($1,$2) RETURNING *'
              : 'INSERT INTO workspace_project(workspace_id,name,system_id) VALUES($1,$2,$3) RETURNING *',
            [workspaceId, values.name, ...('systemId' in values ? [values.systemId] : [])],
          )
        ).rows[0];
      });
      return reply.status(201).send(result);
    });
    app.patch(`/api/workspaces/:workspaceId/data/${kind}/:id`, async (req) => {
      const { workspaceId, id } = recordParams.parse(req.params);
      const values = body.partial().parse(req.body);
      return transaction(req.actor.id, async (db) => {
        await access(db, req.actor.id, workspaceId, true);
        if (
          'systemId' in values &&
          values.systemId &&
          !(
            await db.query('SELECT 1 FROM workspace_system WHERE id=$1 AND workspace_id=$2', [
              values.systemId,
              workspaceId,
            ])
          ).rowCount
        )
          throw new AppError('VALIDATION_FAILED');
        const result = (
          await db.query(
            kind === 'systems'
              ? 'UPDATE workspace_system SET name=coalesce($3,name),version=version+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *'
              : 'UPDATE workspace_project SET name=coalesce($3,name),system_id=coalesce($4,system_id),version=version+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *',
            [
              id,
              workspaceId,
              values.name,
              ...(kind === 'projects' ? [('systemId' in values && values.systemId) || null] : []),
            ],
          )
        ).rows[0];
        if (!result) throw new AppError('NOT_FOUND');
        return result;
      });
    });
    app.delete(`/api/workspaces/:workspaceId/data/${kind}/:id`, async (req) => {
      const { workspaceId, id } = recordParams.parse(req.params);
      return transaction(req.actor.id, async (db) => {
        await access(db, req.actor.id, workspaceId, true);
        if (
          !(
            await db.query(`DELETE FROM ${table} WHERE id=$1 AND workspace_id=$2`, [
              id,
              workspaceId,
            ])
          ).rowCount
        )
          throw new AppError('NOT_FOUND');
        return { ok: true };
      });
    });
  }
}
