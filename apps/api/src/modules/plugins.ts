import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid, versionBody } from '@work/shared';
import type { buildRegistry } from '../plugins/registry';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';
import { getTask } from '../repositories/tasks';
import { manageBoard } from './boards';
export async function registerPlugins(
  app: FastifyInstance,
  registry: ReturnType<typeof buildRegistry>,
) {
  app.get('/api/workspaces/:workspaceId/plugins', async (req) => {
    const wid = uuid.parse((req.params as any).workspaceId);
    if (!(await pool.query('SELECT workspace_role($1,$2) role', [req.actor.id, wid])).rows[0].role)
      throw new AppError('NOT_FOUND');
    const enabled = (
      await pool.query('SELECT plugin_key FROM workspace_plugin WHERE workspace_id=$1', [wid])
    ).rows.map((r) => r.plugin_key);
    return registry.manifests.map((m) => ({ ...m, enabled: enabled.includes(m.key) }));
  });
  for (const action of ['enable', 'disable']) {
    app.post(`/api/workspaces/:workspaceId/plugins/:pluginKey/${action}`, async (req) => {
      const p = z.object({ workspaceId: uuid, pluginKey: z.string() }).parse(req.params);
      if (!registry.extensions.has(p.pluginKey)) throw new AppError('VALIDATION_FAILED');
      return transaction(req.actor.id, async (db) => {
        await db.query('SELECT set_workspace_plugin($1,$2,$3)', [
          p.workspaceId,
          p.pluginKey,
          action === 'enable',
        ]);
        return { ok: true };
      });
    });
  }
  for (const [key, extension] of registry.extensions) {
    app.patch(`/api/plugins/${key}/tasks/:taskId`, async (req) => {
      const tid = uuid.parse((req.params as any).taskId);
      const fieldSchemas: Record<string, z.ZodTypeAny> = Object.fromEntries(
        extension.fields.map((f) => [
          f,
          (f.endsWith('_id')
            ? uuid
            : f === 'severity'
              ? z.enum(['P1', 'P2', 'P3', 'P4'])
              : f.endsWith('_at')
                ? z.string().datetime()
                : z.string().max(10000)
          )
            .nullable()
            .optional(),
        ]),
      );
      const b = z.object(fieldSchemas).merge(versionBody).strict().parse(req.body);
      return transaction(req.actor.id, async (db) => {
        await db.query(`SELECT set_${key}_task_fields($1,$2,$3)`, [tid, b.expectedVersion, b]);
        return getTask(db, req.actor.id, tid);
      });
    });
    app.get(`/api/plugins/${key}/boards/:boardId/options`, async (req) => {
      const bid = uuid.parse((req.params as any).boardId);
      return transaction(req.actor.id, async (db) => {
        const b = (
          await db.query('SELECT * FROM board WHERE id=$1 AND can_read_board($2,id)', [
            bid,
            req.actor.id,
          ])
        ).rows[0];
        if (!b) throw new AppError('NOT_FOUND');
        await db.query('SELECT require_plugin_enabled($1,$2)', [b.workspace_id, key]);
        const result: Record<string, unknown[]> = {};
        for (const table of extension.domainTables)
          result[table] = (
            await db.query(`SELECT * FROM ${table} WHERE board_id=$1 ORDER BY name`, [bid])
          ).rows;
        return result;
      });
    });
    for (const table of extension.domainTables) {
      const slug = table.split('_')[1] + 's';
      app.post(`/api/plugins/${key}/boards/:boardId/${slug}`, async (req) => {
        const bid = uuid.parse((req.params as any).boardId);
        const b = z
          .object({ name: z.string().trim().min(1).max(100), systemId: uuid.optional() })
          .parse(req.body);
        return manageBoard(req.actor.id, bid, async (db) => {
          const board = (await db.query('SELECT * FROM board WHERE id=$1', [bid])).rows[0];
          await db.query('SELECT require_plugin_enabled($1,$2)', [board.workspace_id, key]);
          if (board.plugin_key !== key) throw new AppError('VALIDATION_FAILED');
          if (table === 'rnd_module' && !b.systemId) throw new AppError('VALIDATION_FAILED');
          return (
            await db.query(
              table === 'rnd_module'
                ? 'INSERT INTO rnd_module(workspace_id,board_id,name,system_id) VALUES($1,$2,$3,$4) RETURNING *'
                : `INSERT INTO ${table}(workspace_id,board_id,name) VALUES($1,$2,$3) RETURNING *`,
              [board.workspace_id, bid, b.name, ...(table === 'rnd_module' ? [b.systemId] : [])],
            )
          ).rows[0];
        });
      });
    }
    app.get(`/api/plugins/${key}/boards/:boardId/lanes/:laneId`, async (req) => {
      const p = z.object({ boardId: uuid, laneId: uuid }).parse(req.params);
      return transaction(req.actor.id, async (db) => {
        const board = (
          await db.query('SELECT * FROM board WHERE id=$1 AND can_read_board($2,id)', [
            p.boardId,
            req.actor.id,
          ])
        ).rows[0];
        if (!board) throw new AppError('NOT_FOUND');
        await db.query('SELECT require_plugin_enabled($1,$2)', [board.workspace_id, key]);
        return (
          (
            await db.query(`SELECT * FROM ${key}_lane_ext WHERE lane_id=$1 AND board_id=$2`, [
              p.laneId,
              p.boardId,
            ])
          ).rows[0] ?? {}
        );
      });
    });
    app.patch(`/api/plugins/${key}/boards/:boardId/lanes/:laneId`, async (req) => {
      const p = z.object({ boardId: uuid, laneId: uuid }).parse(req.params);
      const fields =
        key === 'rnd'
          ? ['project_code', 'owner_id', 'start_date', 'target_end_date']
          : ['service_id', 'description'];
      const shape = Object.fromEntries(
        fields.map((f) => [
          f,
          (f.endsWith('_id')
            ? uuid
            : f.endsWith('_date')
              ? z.string().date()
              : z.string().max(2000)
          )
            .nullable()
            .optional(),
        ]),
      );
      const b = z.object(shape).strict().parse(req.body);
      return manageBoard(req.actor.id, p.boardId, async (db) => {
        const board = (await db.query('SELECT * FROM board WHERE id=$1', [p.boardId])).rows[0];
        await db.query('SELECT require_plugin_enabled($1,$2)', [board.workspace_id, key]);
        if (board.plugin_key !== key) throw new AppError('VALIDATION_FAILED');
        await db.query(
          `INSERT INTO ${key}_lane_ext(lane_id,workspace_id,board_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [p.laneId, board.workspace_id, p.boardId],
        );
        const keys = Object.keys(b);
        if (keys.length)
          await db.query(
            `UPDATE ${key}_lane_ext SET ${keys.map((f, i) => `${f}=$${i + 3}`).join(',')},updated_at=now() WHERE lane_id=$1 AND board_id=$2`,
            [p.laneId, p.boardId, ...keys.map((f) => b[f])],
          );
        return (await db.query(`SELECT * FROM ${key}_lane_ext WHERE lane_id=$1`, [p.laneId]))
          .rows[0];
      });
    });
  }
}
