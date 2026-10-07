import { test, expect, afterAll } from 'vitest';
import { pool } from '../apps/api/src/lib/db';
import { buildApp } from '../apps/api/src/app';
import { ids, asActor, session } from './helpers';
afterAll(() => pool.end());
test('concurrent cross-workspace focus never exceeds capacity', async () => {
  const target = (
    await asActor(ids.a, (db) =>
      db.query('SELECT * FROM create_task($1,$2)', [
        '30000000-0000-4000-8000-000000000003',
        { title: 'concurrency target', responsibleUserId: ids.c },
      ]),
    )
  ).rows[0];
  await asActor(ids.admin, (db) => db.query('SELECT set_wip_limit($1,1)', [ids.c]));
  try {
    const result = await Promise.allSettled([
      asActor(ids.c, (db) =>
        db.query('SELECT focus_task($1,$2)', [ids.c, '50000000-0000-4000-8000-000000000001']),
      ),
      asActor(ids.c, (db) => db.query('SELECT focus_task($1,$2)', [ids.c, target.id])),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Number((await pool.query('SELECT wip_usage($1) used', [ids.c])).rows[0].used)).toBe(1);
  } finally {
    await asActor(ids.c, async (db) => {
      await db.query('SELECT unfocus_task($1,$2)', [ids.c, '50000000-0000-4000-8000-000000000001']);
      await db.query('SELECT unfocus_task($1,$2)', [ids.c, target.id]);
    });
    await asActor(ids.admin, (db) => db.query('SELECT set_wip_limit($1,3)', [ids.c]));
  }
});
test('scope exclusive revocation blocks first Focus and hides historical workers in every read path', async () => {
  const app = await buildApp();
  const cookie = await session(ids.d);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.actor_id',$1,true)", [ids.admin]);
    await db.query('SELECT lock_owner($1),lock_workspace($1,true)', [ids.beta]);
    const focus = asActor(ids.d, (c) =>
      c.query('SELECT focus_task($1,$2)', [ids.d, '50000000-0000-4000-8000-000000000003']),
    );
    const handled = focus.then(
      () => ({ ok: true }),
      (e) => ({ ok: false, code: e.message }),
    );
    await db.query("SELECT set_workspace_member($1,$2,'member','inactive')", [ids.beta, ids.d]);
    await db.query('COMMIT');
    expect((await handled).ok).toBe(false);
    expect(Number((await pool.query('SELECT wip_usage($1) used', [ids.d])).rows[0].used)).toBe(0);
    for (const url of [
      '/api/tasks/50000000-0000-4000-8000-000000000003',
      '/api/tasks/50000000-0000-4000-8000-000000000003/comments',
      '/api/tasks/50000000-0000-4000-8000-000000000003/resources',
    ])
      expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404);
    const my = await app.inject({ url: '/api/me/tasks', headers: { cookie } });
    expect(my.json().some((t: any) => t.id === '50000000-0000-4000-8000-000000000003')).toBe(false);
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await asActor(ids.admin, (c) =>
      c.query("SELECT set_workspace_member($1,$2,'member','active')", [ids.beta, ids.d]),
    );
    await app.close();
  }
});
