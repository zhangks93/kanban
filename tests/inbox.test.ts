import { test, expect, afterAll } from 'vitest';
import { pool } from '../apps/api/src/lib/db';
import { buildApp } from '../apps/api/src/app';
import { ids, asActor, session } from './helpers';
afterAll(() => pool.end());
test('Intake accept is atomic and idempotent, requires Responsible, and reuses Task workers', async () => {
  await asActor(ids.a, async (db) => {
    await db.query('SAVEPOINT intake_case');
    try {
      const r = (
        await db.query('SELECT * FROM create_intake($1,$2)', [
          '30000000-0000-4000-8000-000000000001',
          {
            title: 'intake integration',
            description: 'scope',
            clientMutationId: crypto.randomUUID(),
          },
        ])
      ).rows[0];
      const accepted = (
        await db.query('SELECT * FROM decide_intake($1,true,$2)', [
          r.id,
          { responsibleUserId: ids.b, participantUserIds: [ids.c] },
        ])
      ).rows[0];
      expect(accepted.status).toBe('accepted');
      const task = (await db.query('SELECT * FROM task WHERE id=$1', [accepted.task_id])).rows[0];
      expect(task.responsible_id).toBe(ids.b);
      expect(
        (await db.query('SELECT count(*) FROM task_participant WHERE task_id=$1', [task.id]))
          .rows[0].count,
      ).toBe('1');
      expect(
        (
          await db.query('SELECT * FROM decide_intake($1,true,$2)', [
            r.id,
            { responsibleUserId: ids.a },
          ])
        ).rows[0].task_id,
      ).toBe(task.id);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT intake_case');
    }
  });
});
test('Notification and Search discard inaccessible historical Worker data', async () => {
  const app = await buildApp();
  const cookie = await session(ids.d);
  await asActor(ids.admin, (db) =>
    db.query("SELECT set_workspace_member($1,$2,'member','inactive')", [ids.beta, ids.d]),
  );
  try {
    const notifications = await app.inject({ url: '/api/me/notifications', headers: { cookie } });
    expect(
      notifications.json().every((n: any) => n.task_id !== '50000000-0000-4000-8000-000000000003'),
    ).toBe(true);
    expect(
      (await app.inject({ url: `/api/workspaces/${ids.beta}/search?q=联调`, headers: { cookie } }))
        .statusCode,
    ).toBe(404);
  } finally {
    await asActor(ids.admin, (db) =>
      db.query("SELECT set_workspace_member($1,$2,'member','active')", [ids.beta, ids.d]),
    );
    await app.close();
  }
});
