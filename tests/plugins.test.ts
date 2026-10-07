import { test, expect, afterAll } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { assertPluginKeys, coreTemplates } from '../packages/plugin-sdk/src';
import { ids, session, asActor, origin } from './helpers';
import { buildRegistry } from '../apps/api/src/plugins/registry';
afterAll(() => pool.end());
test('registry keys agree, Core works without plugins, and Workspace gating is independent', async () => {
  expect(() => assertPluginKeys({ key: 'a', name: 'a' }, { key: 'b' })).toThrow();
  expect(buildRegistry([]).templates).toHaveLength(2);
  const app = await buildApp([]);
  try {
    const cookie = await session(ids.a);
    const plugins = await app.inject({
      url: `/api/workspaces/${ids.alpha}/plugins`,
      headers: { cookie },
    });
    expect(plugins.json()).toEqual([]);
    const templates = await app.inject({
      url: `/api/workspaces/${ids.beta}/templates`,
      headers: { cookie },
    });
    expect(templates.json().every((t: any) => t.key.startsWith('core.'))).toBe(true);
  } finally {
    await app.close();
  }
});
test('plugin API field mutation shares Core version and disabled Workspace rejects plugin template', async () => {
  const app = await buildApp();
  try {
    const cookie = await session(ids.a);
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ids.beta}/boards`,
      headers: { cookie, origin },
      payload: {
        name: 'invalid rnd',
        key: `R${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        templateKey: 'rnd.development',
        accessMode: 'workspace',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PLUGIN_NOT_ENABLED');
    const stale = await app.inject({
      method: 'PATCH',
      url: '/api/plugins/rnd/tasks/50000000-0000-4000-8000-000000000001',
      headers: { cookie, origin },
      payload: { expectedVersion: 99, module_id: null },
    });
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
  } finally {
    await app.close();
  }
});
test('restricted owner/admin is manager but not eligible Worker without explicit Board membership', async () => {
  await asActor(ids.admin, async (db) => {
    await db.query('SAVEPOINT restricted');
    try {
      const b = (
        await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
          ids.alpha,
          `R${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          'Restricted',
          'restricted',
          coreTemplates[0],
        ])
      ).rows[0];
      const p = (
        await db.query('SELECT can_manage_board($1,$2) manager,is_worker_eligible($1,$2) worker', [
          ids.a,
          b.id,
        ])
      ).rows[0];
      expect(p.manager).toBe(true);
      expect(p.worker).toBe(false);
      await db.query("INSERT INTO board_member(board_id,user_id,role) VALUES($1,$2,'viewer')", [
        b.id,
        ids.b,
      ]);
      expect(
        (
          await db.query('SELECT can_read_board($1,$2) reader,can_edit_board($1,$2) writer', [
            ids.b,
            b.id,
          ])
        ).rows[0],
      ).toEqual({ reader: true, writer: false });
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT restricted');
    }
  });
});
