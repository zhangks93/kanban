import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { asActor, ids, origin, session } from './helpers';
import { coreTemplates } from '../packages/plugin-sdk/src';

const base = '/api/agent/v1';
const alphaBoard = '30000000-0000-4000-8000-000000000001';
const betaBoard = '30000000-0000-4000-8000-000000000003';
const betaTask = '50000000-0000-4000-8000-000000000003';
let app: Awaited<ReturnType<typeof buildApp>>;
let writable: { authorization: string };
let readonly: { authorization: string };
let cookie: string;

async function grant(scopes: string[], approvalCookie = cookie) {
  const request = await app.inject({
    method: 'POST',
    url: '/api/agent/device',
    payload: { clientName: 'agent-data integration test', scopes },
  });
  expect(request.statusCode).toBe(200);
  const { userCode, deviceCode } = request.json();
  const approval = await app.inject({
    method: 'POST',
    url: `/api/agent/requests/${userCode}/approve`,
    headers: { cookie: approvalCookie, origin },
    payload: { workspaceId: ids.alpha, scopes, expiresIn: 3600 },
  });
  expect(approval.statusCode).toBe(200);
  const response = await app.inject({
    method: 'POST',
    url: '/api/agent/device/token',
    payload: { deviceCode },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().status).toBe('approved');
  return { authorization: `Bearer ${response.json().accessToken}` };
}

beforeAll(async () => {
  app = await buildApp();
  cookie = await session(ids.a);
  writable = await grant(['read', 'write']);
  readonly = await grant(['read']);
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});

test('agent discovery and reads are restricted to the granted workspace and current human visibility', async () => {
  const manifest = await app.inject({ url: base, headers: readonly });
  expect(manifest.statusCode).toBe(200);
  expect(manifest.json().apiVersion).toBe('v1');
  expect(
    manifest.json().commands.find((command: any) => command.method === 'PATCH').body.required,
  ).toEqual(['expectedVersion']);
  const me = await app.inject({ url: `${base}/me`, headers: readonly });
  expect(me.json().authorization.workspaceId).toBe(ids.alpha);
  expect(me.json().user).not.toHaveProperty('feishu_open_id');
  const boards = await app.inject({ url: `${base}/boards`, headers: readonly });
  expect(boards.json().length).toBeGreaterThan(0);
  expect(boards.json().every((board: any) => board.workspace_id === ids.alpha)).toBe(true);
  const board = await app.inject({ url: `${base}/boards/${alphaBoard}`, headers: readonly });
  expect(board.statusCode).toBe(200);
  expect(board.json().states.length).toBeGreaterThan(0);
  expect(board.json().workers.some((worker: any) => worker.userId === ids.a)).toBe(true);
  for (const url of [
    `${base}/boards/${betaBoard}`,
    `${base}/tasks/${betaTask}`,
    `${base}/tasks?boardId=${betaBoard}`,
  ])
    expect((await app.inject({ url, headers: readonly })).statusCode).toBe(404);
  expect(
    (await app.inject({ url: `${base}/tasks/${betaTask}`, headers: { cookie } })).statusCode,
  ).toBe(401);
});

test('read grants cannot mutate, write requests require strict bodies and versions', async () => {
  const taskId = '50000000-0000-4000-8000-000000000001';
  for (const method of ['PATCH', 'DELETE'] as const)
    expect(
      (
        await app.inject({
          method,
          url: `${base}/tasks/${taskId}`,
          headers: readonly,
          payload: { expectedVersion: 1, title: 'forbidden' },
        })
      ).statusCode,
    ).toBe(403);
  for (const payload of [
    { title: 'missing version' },
    { expectedVersion: 1, typo: true },
    { expectedVersion: 1 },
  ])
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${base}/tasks/${taskId}`,
          headers: writable,
          payload,
        })
      ).statusCode,
    ).toBe(422);
  for (const query of [
    'limit=0',
    'limit=101',
    'cursor=bad',
    'unsupported=true',
    'stateGroup=unknown',
  ])
    expect(
      (await app.inject({ url: `${base}/tasks?${query}`, headers: readonly })).statusCode,
    ).toBe(422);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${base}/boards/${alphaBoard}/tasks`,
        headers: writable,
        payload: { title: 'missing mutation ID', responsibleUserId: ids.a },
      })
    ).statusCode,
  ).toBe(422);
});

test('creates are idempotent and mutations retain optimistic concurrency and human attribution', async () => {
  const title = `agent-write-${crypto.randomUUID()}`;
  const payload = {
    title,
    responsibleUserId: ids.a,
    clientMutationId: crypto.randomUUID(),
    estimateDays: 3,
    description: { z: 'last', a: 'first' },
  };
  const create = () =>
    app.inject({
      method: 'POST',
      url: `${base}/boards/${alphaBoard}/tasks`,
      headers: writable,
      payload,
    });
  const [first, retry] = await Promise.all([create(), create()]);
  expect(first.statusCode).toBe(201);
  expect(retry.statusCode).toBe(201);
  expect(first.json().id).toBe(retry.json().id);
  const reordered = await app.inject({
    method: 'POST',
    url: `${base}/boards/${alphaBoard}/tasks`,
    headers: writable,
    payload: { ...payload, description: { a: 'first', z: 'last' } },
  });
  expect(reordered.statusCode).toBe(201);
  expect(reordered.json().id).toBe(first.json().id);
  const changedPayload = await app.inject({
    method: 'POST',
    url: `${base}/boards/${alphaBoard}/tasks`,
    headers: writable,
    payload: { ...payload, title: `${title}-different-operation` },
  });
  expect(changedPayload.statusCode).toBe(409);
  expect(changedPayload.json().error.code).toBe('DEPENDENCY_CONFLICT');
  const created = first.json();
  expect(created.estimate_days).toBe(3);
  const update = await app.inject({
    method: 'PATCH',
    url: `${base}/tasks/${created.id}`,
    headers: writable,
    payload: { expectedVersion: created.version, title: `${title}-updated`, priority: 'high' },
  });
  expect(update.statusCode).toBe(200);
  expect(update.json().version).toBe(created.version + 1);
  const retriedAfterEdit = await create();
  expect(retriedAfterEdit.statusCode).toBe(201);
  expect(retriedAfterEdit.json().version).toBe(update.json().version);
  const stale = await app.inject({
    method: 'PATCH',
    url: `${base}/tasks/${created.id}`,
    headers: writable,
    payload: { expectedVersion: created.version, title: `${title}-stale` },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe('VERSION_CONFLICT');
  const activity = (
    await pool.query(
      'SELECT actor_id,agent_authorization_id FROM task_activity WHERE task_id=$1 ORDER BY id DESC LIMIT 1',
      [created.id],
    )
  ).rows[0];
  expect(activity.actor_id).toBe(ids.a);
  expect(activity.agent_authorization_id).toBeTruthy();
  const deleted = await app.inject({
    method: 'DELETE',
    url: `${base}/tasks/${created.id}`,
    headers: writable,
    payload: { expectedVersion: update.json().version },
  });
  expect(deleted.statusCode).toBe(200);
  expect(deleted.json().deleted).toBe(true);
  expect(
    (await app.inject({ url: `${base}/tasks/${created.id}`, headers: readonly })).statusCode,
  ).toBe(404);
});

test('bounded cursor enumeration is complete, filter-bound, and scope-filtered on every page', async () => {
  const title = `agent-page-${crypto.randomUUID()}`;
  const created = [];
  for (let index = 0; index < 3; index++) {
    const response = await app.inject({
      method: 'POST',
      url: `${base}/boards/${alphaBoard}/tasks`,
      headers: writable,
      payload: {
        title: `${title}-${index}`,
        responsibleUserId: ids.a,
        clientMutationId: crypto.randomUUID(),
      },
    });
    expect(response.statusCode).toBe(201);
    created.push(response.json().id);
  }
  let cursor: string | null = null;
  const seen: string[] = [];
  do {
    const query = new URLSearchParams({ q: title, limit: '1' });
    if (cursor) query.set('cursor', cursor);
    const page = await app.inject({ url: `${base}/tasks?${query}`, headers: readonly });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(1);
    expect(page.json().items[0].workspace_id).toBe(ids.alpha);
    seen.push(page.json().items[0].id);
    cursor = page.json().nextCursor;
    if (cursor) {
      const changed = new URLSearchParams({ q: `${title}-changed`, cursor });
      expect(
        (await app.inject({ url: `${base}/tasks?${changed}`, headers: readonly })).statusCode,
      ).toBe(422);
    }
  } while (cursor);
  expect(seen).toEqual([...created].sort());
});

test('mutation ID collisions across boards never reveal another workspace task', async () => {
  const clientMutationId = crypto.randomUUID();
  const outside = await asActor(
    ids.a,
    async (db) =>
      (
        await db.query('SELECT * FROM create_task($1,$2)', [
          betaBoard,
          { title: 'outside grant', responsibleUserId: ids.a, clientMutationId },
        ])
      ).rows[0],
  );
  const response = await app.inject({
    method: 'POST',
    url: `${base}/boards/${alphaBoard}/tasks`,
    headers: writable,
    payload: { title: 'inside grant', responsibleUserId: ids.a, clientMutationId },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('DEPENDENCY_CONFLICT');
  expect(response.body).not.toContain(outside.id);
});

test('write scope cannot elevate a human viewer and later board revocation takes effect', async () => {
  const board = await asActor(ids.a, async (db) => {
    const created = (
      await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
        ids.alpha,
        `AV${crypto.randomUUID().slice(0, 8)}`,
        'Agent viewer boundary',
        'restricted',
        coreTemplates[0],
      ])
    ).rows[0];
    await db.query("INSERT INTO board_member(board_id,user_id,role) VALUES($1,$2,'viewer')", [
      created.id,
      ids.b,
    ]);
    return created;
  });
  const viewer = await grant(['read', 'write'], await session(ids.b));
  expect(
    (await app.inject({ url: `${base}/boards/${board.id}`, headers: viewer })).statusCode,
  ).toBe(200);
  const creation = await app.inject({
    method: 'POST',
    url: `${base}/boards/${board.id}/tasks`,
    headers: viewer,
    payload: {
      title: 'viewer cannot create',
      responsibleUserId: ids.a,
      clientMutationId: crypto.randomUUID(),
    },
  });
  expect(creation.statusCode).toBe(403);
  await asActor(ids.a, (db) =>
    db.query('DELETE FROM board_member WHERE board_id=$1 AND user_id=$2', [board.id, ids.b]),
  );
  expect(
    (await app.inject({ url: `${base}/boards/${board.id}`, headers: viewer })).statusCode,
  ).toBe(404);
});
