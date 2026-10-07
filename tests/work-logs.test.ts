import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { coreTemplates } from '../packages/plugin-sdk/src';
import { asActor, ids, origin, session } from './helpers';

const app = await buildApp();
let boardId: string;
let taskId: string;
let otherTaskId: string;
let headers: { cookie: string; origin: string };
let otherHeaders: { cookie: string; origin: string };
const workDate = '2020-01-02';
beforeAll(async () => {
  headers = { cookie: await session(ids.a), origin };
  otherHeaders = { cookie: await session(ids.b), origin };
  await asActor(ids.a, async (db) => {
    boardId = (
      await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
        ids.alpha,
        `E${crypto.randomUUID().slice(0, 8)}`,
        '工时测试',
        'workspace',
        coreTemplates[0],
      ])
    ).rows[0].id;
    taskId = (
      await db.query('SELECT * FROM create_task($1,$2)', [
        boardId,
        {
          title: 'effort',
          responsibleUserId: ids.a,
          estimateDays: 3,
        },
      ])
    ).rows[0].id;
    otherTaskId = (
      await db.query('SELECT * FROM create_task($1,$2)', [
        boardId,
        {
          title: 'other',
          responsibleUserId: ids.b,
        },
      ])
    ).rows[0].id;
  });
});
afterAll(async () => {
  if (boardId) {
    await asActor(ids.a, async (db) => {
      await db.query("UPDATE board SET status='active',access_mode='workspace' WHERE id=$1", [
        boardId,
      ]);
      await db.query('UPDATE task SET deleted_at=NULL WHERE board_id=$1', [boardId]);
      await db.query('DELETE FROM task_work_log WHERE board_id=$1 AND user_id=$2', [
        boardId,
        ids.a,
      ]);
    });
    await asActor(ids.b, (db) =>
      db.query('DELETE FROM task_work_log WHERE board_id=$1 AND user_id=$2', [boardId, ids.b]),
    );
  }
  await app.close();
  await pool.end();
});
const create = (tid: string, body: object, requestHeaders = headers) =>
  app.inject({
    method: 'POST',
    url: `/api/tasks/${tid}/work-logs`,
    headers: requestHeaders,
    payload: {
      workDate,
      hours: 2,
      note: '完成接口联调',
      clientMutationId: crypto.randomUUID(),
      ...body,
    },
  });

test('estimates persist on creation, use optimistic versions, and can be cleared', async () => {
  const t = (await app.inject({ url: `/api/tasks/${taskId}`, headers })).json();
  expect(t.estimate_days).toBe(3);
  expect(t.logged_hours).toBe(0);
  const invalid = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers,
    payload: { expectedVersion: t.version, estimateDays: 4 },
  });
  expect(invalid.statusCode).toBe(422);
  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers,
    payload: { expectedVersion: t.version, estimateDays: 5 },
  });
  expect(changed.json()).toMatchObject({ estimate_days: 5, version: t.version + 1 });
  const stale = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers,
    payload: { expectedVersion: t.version, estimateDays: 8 },
  });
  expect(stale.statusCode).toBe(409);
  const cleared = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers,
    payload: { expectedVersion: changed.json().version, estimateDays: null },
  });
  expect(cleared.json().estimate_days).toBeNull();
});

test('logs require whole hours and a valid nonfuture date and explanation', async () => {
  for (const body of [
    { hours: 0 },
    { hours: 1.5 },
    { hours: 25 },
    { note: '  ' },
    { workDate: '2020-02-30' },
    { workDate: '2099-01-01' },
  ]) {
    const r = await create(taskId, body);
    expect(r.statusCode, JSON.stringify(body)).toBe(422);
    expect(r.json().error.code).toBe('VALIDATION_FAILED');
  }
});

test('retry is idempotent, author is the actor, and logs do not bump Task version', async () => {
  const before = (await app.inject({ url: `/api/tasks/${taskId}`, headers })).json();
  const clientMutationId = crypto.randomUUID();
  const [a, b] = await Promise.all([
    create(taskId, { clientMutationId, userId: ids.b }),
    create(taskId, { clientMutationId }),
  ]);
  expect(a.statusCode).toBe(201);
  expect(b.statusCode).toBe(201);
  expect(a.json().id).toBe(b.json().id);
  expect(a.json().user_id).toBe(ids.a);
  const after = (await app.inject({ url: `/api/tasks/${taskId}`, headers })).json();
  expect(after.version).toBe(before.version);
  expect(after.logged_hours).toBe(2);
  const wrongTask = await create(otherTaskId, { clientMutationId });
  expect(wrongTask.statusCode).toBe(422);
});

test('only the author can change logs; stale edits conflict and delete removes hours', async () => {
  const entry = (await create(taskId, { workDate: '2020-01-03', hours: 3 })).json();
  const url = `/api/tasks/${taskId}/work-logs/${entry.id}`;
  const payload = { expectedVersion: 1, workDate: '2020-01-03', hours: 4, note: '回归测试' };
  expect(
    (await app.inject({ method: 'PATCH', url, headers: otherHeaders, payload })).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url,
        headers: otherHeaders,
        payload: { expectedVersion: 1 },
      })
    ).statusCode,
  ).toBe(403);
  const edited = await app.inject({ method: 'PATCH', url, headers, payload });
  expect(edited.json()).toMatchObject({ hours: 4, version: 2 });
  expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(409);
  expect(
    (await app.inject({ method: 'DELETE', url, headers, payload: { expectedVersion: 1 } }))
      .statusCode,
  ).toBe(409);
  expect(
    (await app.inject({ method: 'DELETE', url, headers, payload: { expectedVersion: 2 } }))
      .statusCode,
  ).toBe(200);
  const task = (await app.inject({ url: `/api/tasks/${taskId}`, headers })).json();
  expect(task.logged_hours).toBe(2);
  const activity = (await app.inject({ url: `/api/tasks/${taskId}/activity`, headers })).json();
  expect(activity.map((a: { action: string }) => a.action)).toEqual(
    expect.arrayContaining(['work-log.add', 'work-log.update', 'work-log.delete']),
  );
});

test('concurrent entries across tasks cannot exceed the user daily limit; date edits are checked', async () => {
  const [a, b] = await Promise.all([
    create(taskId, { hours: 15, workDate: '2020-02-01' }),
    create(otherTaskId, { hours: 15, workDate: '2020-02-01' }),
  ]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422]);
  expect((a.statusCode === 422 ? a : b).json().error.code).toBe('WORK_LOG_DAILY_LIMIT');
  const different = await create(taskId, { hours: 15, workDate: '2020-02-01' }, otherHeaders);
  expect(different.statusCode).toBe(201);
  const next = (await create(taskId, { hours: 10, workDate: '2020-02-02' })).json();
  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}/work-logs/${next.id}`,
    headers,
    payload: { expectedVersion: next.version, hours: 10, workDate: '2020-02-01', note: '修正日期' },
  });
  expect(edited.json().error.code).toBe('WORK_LOG_DAILY_LIMIT');
});

test('reports aggregate by recorded author, task and inclusive dates after responsibility changes', async () => {
  await create(taskId, { hours: 5 }, otherHeaders);
  const task = (await app.inject({ url: `/api/tasks/${taskId}`, headers })).json();
  await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers,
    payload: { expectedVersion: task.version, responsibleUserId: ids.b },
  });
  const response = await app.inject({
    url: `/api/work-logs/report?taskId=${taskId}&workspaceId=${ids.alpha}&from=${workDate}&to=${workDate}`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ totalHours: 7, totalEntries: 2, hoursPerDay: 8 });
  expect(response.json().byUser).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: ids.a, hours: 2 }),
      expect.objectContaining({ userId: ids.b, hours: 5 }),
    ]),
  );
  expect(response.json().byDate).toEqual([{ workDate, hours: 7 }]);
  expect(response.json().byTask[0]).toMatchObject({ taskId, hours: 7 });
  const filtered = (
    await app.inject({
      url: `/api/work-logs/report?taskId=${taskId}&userId=${ids.b}&from=${workDate}&to=${workDate}`,
      headers,
    })
  ).json();
  expect(filtered.totalHours).toBe(5);
  expect(filtered.byTask[0].totalTaskHours).toBe(response.json().byTask[0].totalTaskHours);
  expect(
    (await app.inject({ url: '/api/work-logs/report?from=2020-01-03&to=2020-01-01', headers }))
      .statusCode,
  ).toBe(422);
});

test('restricted viewers read without writing; revoked access hides logs and reports', async () => {
  await asActor(ids.a, async (db) => {
    await db.query("UPDATE board SET access_mode='restricted' WHERE id=$1", [boardId]);
    await db.query("INSERT INTO board_member(board_id,user_id,role) VALUES($1,$2,'viewer')", [
      boardId,
      ids.b,
    ]);
  });
  expect(
    (await app.inject({ url: `/api/tasks/${taskId}/work-logs`, headers: otherHeaders })).statusCode,
  ).toBe(200);
  expect((await create(taskId, {}, otherHeaders)).statusCode).toBe(403);
  await asActor(ids.a, (db) =>
    db.query('DELETE FROM board_member WHERE board_id=$1 AND user_id=$2', [boardId, ids.b]),
  );
  expect(
    (await app.inject({ url: `/api/tasks/${taskId}/work-logs`, headers: otherHeaders })).statusCode,
  ).toBe(404);
  expect((await create(taskId, {}, otherHeaders)).statusCode).toBe(404);
  const hidden = (
    await app.inject({ url: `/api/work-logs/report?taskId=${taskId}`, headers: otherHeaders })
  ).json();
  expect(hidden).toMatchObject({ totalHours: 0, byUser: [], byTask: [], byDate: [] });
});

test('pagination includes complete totals, and archived/deleted tasks retain history', async () => {
  for (let i = 1; i <= 51; i++)
    await create(otherTaskId, {
      workDate: `2020-03-${String(Math.ceil(i / 2)).padStart(2, '0')}`,
      hours: 1,
    });
  const first = (await app.inject({ url: `/api/tasks/${otherTaskId}/work-logs`, headers })).json();
  const second = (
    await app.inject({ url: `/api/tasks/${otherTaskId}/work-logs?offset=50`, headers })
  ).json();
  expect(first.entries).toHaveLength(50);
  expect(second.entries.length).toBe(first.total - 50);
  expect(second.totalHours).toBe(first.totalHours);
  const task = (await app.inject({ url: `/api/tasks/${otherTaskId}`, headers })).json();
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/tasks/${otherTaskId}`,
        headers,
        payload: { expectedVersion: task.version },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: `/api/work-logs/report?taskId=${otherTaskId}`, headers })).json()
      .totalHours,
  ).toBe(0);
  expect(
    (
      await pool.query('SELECT count(*)::integer AS n FROM task_work_log WHERE task_id=$1', [
        otherTaskId,
      ])
    ).rows[0].n,
  ).toBe(first.total);
  await asActor(ids.a, (db) =>
    db.query("UPDATE board SET status='archived' WHERE id=$1", [boardId]),
  );
  expect(
    (await app.inject({ url: `/api/work-logs/report?taskId=${taskId}`, headers })).json()
      .totalHours,
  ).toBe(0);
});
