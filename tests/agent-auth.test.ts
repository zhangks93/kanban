import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { hash, random } from '../apps/api/src/middleware/auth';
import { asActor, ids, origin, session } from './helpers';

const userId = crypto.randomUUID();
const outsideUserId = crypto.randomUUID();
let workspaceId: string;
let cookie: string;
let app: Awaited<ReturnType<typeof buildApp>>;
const remoteAddress = '127.0.0.61';

beforeAll(async () => {
  await pool.query('INSERT INTO app_user(id,display_name) VALUES($1,$2),($3,$4)', [
    userId,
    'Agent authorization test user',
    outsideUserId,
    'Unrelated authorization user',
  ]);
  workspaceId = await asActor(ids.admin, async (db) => {
    const workspace = (
      await db.query('SELECT * FROM create_workspace($1,$2)', [
        `agent-auth-${crypto.randomUUID()}`,
        'Agent authorization test workspace',
      ])
    ).rows[0];
    await db.query("SELECT set_workspace_member($1,$2,'member','active')", [workspace.id, userId]);
    return workspace.id;
  });
  cookie = await session(userId);
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  if (workspaceId) {
    await asActor(ids.admin, async (db) => {
      await db.query(
        'DELETE FROM agent_device_request WHERE decided_by=$2 OR authorization_id IN(SELECT id FROM agent_authorization WHERE workspace_id=$1)',
        [workspaceId, userId],
      );
      await db.query('DELETE FROM agent_request_log WHERE workspace_id=$1', [workspaceId]);
      await db.query('DELETE FROM audit_log WHERE workspace_id=$1', [workspaceId]);
      await db.query('DELETE FROM agent_authorization WHERE workspace_id=$1', [workspaceId]);
      await db.query('DELETE FROM workspace_member WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        userId,
      ]);
      // Workspaces use an archive lifecycle; their delete audit intentionally
      // retains a workspace reference. Keep the admin owner on this fixture.
      await db.query("UPDATE workspace SET status='archived' WHERE id=$1", [workspaceId]);
      await db.query('DELETE FROM auth_session WHERE user_id IN($1,$2)', [userId, outsideUserId]);
      await db.query('DELETE FROM app_user WHERE id IN($1,$2)', [userId, outsideUserId]);
    });
  }
  await pool.end();
});

async function device(scopes: ('read' | 'write')[] = ['read']) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/agent/device',
    remoteAddress,
    payload: { clientName: 'Integration test Agent', scopes },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return response.json() as {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  };
}

function poll(deviceCode: string) {
  return app.inject({
    method: 'POST',
    url: '/api/agent/device/token',
    remoteAddress,
    payload: { deviceCode },
  });
}

function approve(userCode: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/agent/requests/${userCode}/approve`,
    headers: { cookie, origin },
    payload: { workspaceId, scopes: ['read'], expiresIn: 3600, ...overrides },
  });
}

async function grant(scopes: ('read' | 'write')[] = ['read']) {
  const token = random();
  const id = await asActor(userId, async (db) => {
    const row = (
      await db.query(
        `INSERT INTO agent_authorization(user_id,workspace_id,client_name,scopes,token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 hour') RETURNING id`,
        [userId, workspaceId, 'Direct integration test grant', scopes, hash(token)],
      )
    ).rows[0];
    return row.id as string;
  });
  return { id, token, headers: { authorization: `Bearer ${token}` } };
}

test('device flow starts without a session, stores only hashes, and cannot authorize itself', async () => {
  const request = await device();
  expect(request.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(request.userCode).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  expect(request.expiresIn).toBe(600);
  expect(request.interval).toBe(5);
  const verification = new URL(request.verificationUri);
  expect(verification.origin).toBe(origin);
  expect(verification.pathname).toBe('/agent-access');
  expect(verification.searchParams.get('code')).toBe(request.userCode);
  const stored = (
    await pool.query('SELECT * FROM agent_device_request WHERE device_code_hash=$1', [
      hash(request.deviceCode),
    ])
  ).rows[0];
  expect(stored.user_code_hash).toBe(hash(request.userCode));
  expect(JSON.stringify(stored)).not.toContain(request.deviceCode);
  expect(JSON.stringify(stored)).not.toContain(request.userCode);
  expect((await poll(request.deviceCode)).json()).toEqual({ status: 'pending' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/agent/requests/${request.userCode}/approve`,
        headers: { origin },
        payload: { workspaceId, scopes: ['read'] },
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject(`/api/agent/requests/${request.userCode}`)).statusCode).toBe(401);
  const lookup = await app.inject({
    url: `/api/agent/requests/${request.userCode}`,
    headers: { cookie },
  });
  expect(lookup.statusCode).toBe(200);
  expect(lookup.json()).toMatchObject({
    clientName: 'Integration test Agent',
    scopes: ['read'],
    status: 'pending',
  });
});

test('human approval can narrow scopes; concurrent polling consumes the credential once', async () => {
  const request = await device(['read', 'write']);
  expect((await approve(request.userCode, { userId: ids.admin })).statusCode).toBe(422);
  expect((await approve(request.userCode)).statusCode).toBe(200);
  expect((await approve(request.userCode)).statusCode).toBe(404);
  const responses = await Promise.all([poll(request.deviceCode), poll(request.deviceCode)]);
  expect(responses.map((response) => response.json().status).sort()).toEqual([
    'approved',
    'expired',
  ]);
  const approved = responses.find((response) => response.json().status === 'approved')!.json();
  expect(approved.authorization).toMatchObject({ workspaceId, scopes: ['read'] });
  expect(approved.tokenType).toBe('Bearer');
  const headers = { authorization: `Bearer ${approved.accessToken}` };
  const me = await app.inject({ url: '/api/agent/v1/me', headers });
  expect(me.statusCode).toBe(200);
  expect(me.json().user.id).toBe(userId);
  expect(me.json().authorization.scopes).toEqual(['read']);
  expect((await app.inject({ url: '/api/agent/v1', headers })).statusCode).toBe(200);
  const stored = (
    await pool.query('SELECT * FROM agent_authorization WHERE id=$1', [approved.authorization.id])
  ).rows[0];
  expect(stored.token_hash).toBe(hash(approved.accessToken));
  expect(stored.user_id).toBe(userId);
  expect(JSON.stringify(stored)).not.toContain(approved.accessToken);
  const write = await app.inject({
    method: 'DELETE',
    url: `/api/agent/v1/tasks/${crypto.randomUUID()}`,
    headers,
    payload: { expectedVersion: 1 },
  });
  expect(write.statusCode).toBe(403);
  expect(write.json().error.code).toBe('FORBIDDEN');
  expect(write.json().error.requestId).toBeTruthy();
});

test('approval enforces browser CSRF, requested scopes, membership and maximum lifetime', async () => {
  const request = await device();
  const approvalUrl = `/api/agent/requests/${request.userCode}/approve`;
  const payload = { workspaceId, scopes: ['read'], expiresIn: 3600 };
  for (const headers of [{ cookie }, { cookie, origin: 'https://untrusted.invalid' }]) {
    expect(
      (await app.inject({ method: 'POST', url: approvalUrl, headers, payload })).statusCode,
    ).toBe(403);
  }
  expect((await approve(request.userCode, { scopes: ['read', 'write'] })).statusCode).toBe(403);
  expect((await approve(request.userCode, { workspaceId: ids.alpha })).statusCode).toBe(404);
  expect((await approve(request.userCode, { expiresIn: 43201 })).statusCode).toBe(422);
  const authorization = await grant(['read', 'write']);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: approvalUrl,
        headers: { ...authorization.headers, cookie, origin },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  expect((await poll(request.deviceCode)).json()).toEqual({ status: 'pending' });
  expect((await approve(request.userCode)).statusCode).toBe(200);
});

test('Agent tokens and browser sessions have separate authentication boundaries', async () => {
  const authorization = await grant(['read', 'write']);
  expect((await app.inject({ url: '/api/agent/v1/me', headers: { cookie } })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/agent/v1/me',
        headers: { cookie, authorization: `Bearer ${random()}` },
      })
    ).statusCode,
  ).toBe(401);
  for (const url of ['/api/me', '/api/admin/users', '/api/agent/authorizations']) {
    expect((await app.inject({ url, headers: authorization.headers })).statusCode).toBe(403);
  }
  expect(
    (await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie }, payload: {} }))
      .statusCode,
  ).toBe(403);
  expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
});

test('browser revocation checks ownership, and a read-only Agent can revoke its own grant', async () => {
  const authorization = await grant();
  const otherCookie = await session(outsideUserId);
  const revokeUrl = `/api/agent/authorizations/${authorization.id}/revoke`;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: revokeUrl,
        headers: { cookie: otherCookie, origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ url: '/api/agent/v1/me', headers: authorization.headers })).statusCode,
  ).toBe(200);
  const listing = await app.inject({ url: '/api/agent/authorizations', headers: { cookie } });
  expect(listing.statusCode).toBe(200);
  expect(JSON.stringify(listing.json())).not.toContain(authorization.token);
  expect(JSON.stringify(listing.json())).not.toContain('token_hash');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: revokeUrl,
        headers: { cookie, origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: '/api/agent/v1/me', headers: authorization.headers })).statusCode,
  ).toBe(401);
  const self = await grant();
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/agent/v1/authorization',
        headers: self.headers,
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/api/agent/v1/me', headers: self.headers })).statusCode).toBe(
    401,
  );
});

test('expiry, account deactivation and membership loss invalidate access on the next call', async () => {
  const expired = await grant();
  await pool.query(
    "UPDATE agent_authorization SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
    [expired.id],
  );
  expect((await app.inject({ url: '/api/agent/v1/me', headers: expired.headers })).statusCode).toBe(
    401,
  );
  const authorization = await grant(['read', 'write']);
  try {
    await asActor(ids.admin, (db) =>
      db.query("SELECT set_user_status($1,'deactivated')", [userId]),
    );
    expect(
      (await app.inject({ url: '/api/agent/v1/me', headers: authorization.headers })).statusCode,
    ).toBe(401);
  } finally {
    await asActor(ids.admin, (db) => db.query("SELECT set_user_status($1,'active')", [userId]));
  }
  expect(
    (await app.inject({ url: '/api/agent/v1/me', headers: authorization.headers })).statusCode,
  ).toBe(200);
  try {
    await asActor(ids.admin, (db) =>
      db.query("SELECT set_workspace_member($1,$2,'member','inactive')", [workspaceId, userId]),
    );
    expect(
      (await app.inject({ url: '/api/agent/v1/me', headers: authorization.headers })).statusCode,
    ).toBe(401);
  } finally {
    await asActor(ids.admin, (db) =>
      db.query("SELECT set_workspace_member($1,$2,'member','active')", [workspaceId, userId]),
    );
  }
});

test('denied, expired and unknown device secrets never return credentials', async () => {
  const denied = await device();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/agent/requests/${denied.userCode}/deny`,
        headers: { cookie, origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await poll(denied.deviceCode)).json()).toEqual({ status: 'denied' });
  expect((await approve(denied.userCode)).statusCode).toBe(404);
  const expired = await device();
  await pool.query(
    "UPDATE agent_device_request SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE device_code_hash=$1",
    [hash(expired.deviceCode)],
  );
  expect((await poll(expired.deviceCode)).json()).toEqual({ status: 'expired' });
  expect((await approve(expired.userCode)).statusCode).toBe(404);
  expect((await poll(random())).json()).toEqual({ status: 'expired' });
});

test('request audit records the human and grant without retaining credentials or query text', async () => {
  const authorization = await grant();
  const response = await app.inject({
    url: '/api/agent/v1/tasks?q=private-search-text',
    headers: authorization.headers,
  });
  expect(response.statusCode).toBe(200);
  let audit: Record<string, unknown> | undefined;
  // onResponse persists the audit after the injected response becomes available.
  // Wait for that actual database write rather than assuming injection drains it.
  await expect
    .poll(
      async () => {
        audit = (
          await pool.query('SELECT * FROM agent_request_log WHERE request_id=$1', [
            response.headers['x-request-id'],
          ])
        ).rows[0];
        return audit;
      },
      { timeout: 5000, interval: 25 },
    )
    .toMatchObject({
      authorization_id: authorization.id,
      actor_id: userId,
      workspace_id: workspaceId,
      method: 'GET',
      route: '/api/agent/v1/tasks',
      status_code: 200,
    });
  expect(JSON.stringify(audit)).not.toContain(authorization.token);
  expect(JSON.stringify(audit)).not.toContain('private-search-text');
  const lifecycle = (
    await pool.query(
      "SELECT actor_id,after FROM audit_log WHERE entity_id=$1 AND action='agent.authorize'",
      [authorization.id],
    )
  ).rows[0];
  expect(lifecycle.actor_id).toBe(userId);
  expect(lifecycle.after).toMatchObject({ userId, scopes: ['read'] });
  expect(lifecycle.after).not.toHaveProperty('token_hash');
});
