import { test, expect, afterAll } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { buildFakeFeishu } from '../apps/api/src/testing/fake-feishu';
import { safeNext } from '../apps/api/src/modules/auth';
import { pool } from '../apps/api/src/lib/db';
import { ids, session, origin, asActor } from './helpers';
afterAll(() => pool.end());
test('relative next rejects open redirects and backslashes', () => {
  for (const value of ['//evil.test', 'https://evil.test', '/\\evil.test', '/\nfoo'])
    expect(safeNext(value)).toBe('/my');
  expect(safeNext('/workspaces/alpha/boards')).toBe('/workspaces/alpha/boards');
});
test('fake Feishu first login, returning profile, state replay and unauthenticated API', async () => {
  const app = await buildApp();
  const fake = buildFakeFeishu();
  await fake.listen({ host: '127.0.0.1', port: 4001 });
  try {
    expect((await app.inject('/api/me')).statusCode).toBe(401);
    async function login() {
      const start = await app.inject('/auth/feishu/start?next=/my');
      const cookie = start.headers['set-cookie'] as string;
      const params = new URL(start.headers.location!).searchParams;
      const approval = await fake.inject(
        `/approve?redirect_uri=${encodeURIComponent(params.get('redirect_uri')!)}&state=${params.get('state')}&user=new_user`,
      );
      const url = new URL(approval.headers.location!);
      const callback = await app.inject({
        url: url.pathname + url.search,
        headers: { cookie: cookie.split(';')[0] },
      });
      return { callback, url, cookie };
    }
    const first = await login();
    expect(first.callback.statusCode).toBe(302);
    expect(String(first.callback.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(
      (
        await app.inject({
          url: first.url.pathname + first.url.search,
          headers: { cookie: first.cookie.split(';')[0] },
        })
      ).statusCode,
    ).toBe(401);
    await pool.query(
      "UPDATE app_user SET display_name='old profile' WHERE feishu_open_id='new_user'",
    );
    expect((await login()).callback.statusCode).toBe(302);
    expect(
      (await pool.query("SELECT display_name FROM app_user WHERE feishu_open_id='new_user'"))
        .rows[0].display_name,
    ).toBe('新用户');
  } finally {
    await fake.close();
    await app.close();
  }
});
test('session rereads account status and Origin guards mutations', async () => {
  const app = await buildApp();
  try {
    const cookie = await session(ids.d);
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie }, payload: {} }))
        .statusCode,
    ).toBe(403);
    await asActor(ids.admin, (db) =>
      db.query('SELECT set_user_status($1,$2)', [ids.d, 'deactivated']),
    );
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    await asActor(ids.admin, (db) => db.query('SELECT set_user_status($1,$2)', [ids.d, 'active']));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/logout',
          headers: { cookie, origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await asActor(ids.admin, (db) => db.query('SELECT set_user_status($1,$2)', [ids.d, 'active']));
    await app.close();
  }
});
test('concurrent owner demotion cannot leave zero effective owners', async () => {
  const wid = crypto.randomUUID();
  await asActor(ids.admin, async (db) => {
    await db.query('INSERT INTO workspace(id,key,name,created_by) VALUES($1,$2,$2,$3)', [
      wid,
      `owner-${wid}`,
      ids.admin,
    ]);
    await db.query(
      "INSERT INTO workspace_member(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'owner')",
      [wid, ids.admin, ids.a],
    );
  });
  const outcomes = await Promise.allSettled([
    asActor(ids.admin, (db) =>
      db.query("SELECT set_workspace_member($1,$2,'member','active')", [wid, ids.admin]),
    ),
    asActor(ids.a, (db) =>
      db.query("SELECT set_workspace_member($1,$2,'member','active')", [wid, ids.a]),
    ),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(
    Number((await pool.query('SELECT effective_owner_count($1) count', [wid])).rows[0].count),
  ).toBe(1);
  await pool.query('DELETE FROM audit_log WHERE workspace_id=$1', [wid]);
  await pool.query('DELETE FROM workspace WHERE id=$1', [wid]).catch(() => {});
});
