import { test, expect, afterAll } from 'vitest';
import { pool } from '../apps/api/src/lib/db';
import { coreTemplates } from '../packages/plugin-sdk/src';
import { ids, asActor, session, origin } from './helpers';
import { buildApp } from '../apps/api/src/app';
afterAll(() => pool.end());
test('atomic move validates all fields, bumps once, and stale concurrent requests conflict', async () => {
  await asActor(ids.a, async (db) => {
    await db.query('SAVEPOINT scenario');
    try {
      const board = (
        await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
          ids.alpha,
          `T${crypto.randomUUID().slice(0, 8)}`,
          '原子测试',
          'workspace',
          coreTemplates[1],
        ])
      ).rows[0];
      const t = (
        await db.query('SELECT * FROM create_task($1,$2)', [
          board.id,
          { title: 'atomic', responsibleUserId: ids.a, participantUserIds: [ids.b, ids.c] },
        ])
      ).rows[0];
      await db.query('SAVEPOINT invalid_move');
      const state = (
        await db.query("SELECT id FROM board_state WHERE board_id=$1 AND state_group='started'", [
          board.id,
        ])
      ).rows[0];
      await expect(
        db.query('SELECT move_task($1,$2,$3)', [
          t.id,
          t.version,
          { stateId: state.id, laneId: '40000000-0000-4000-8000-000000000001' },
        ]),
      ).rejects.toMatchObject({ message: 'LANE_NOT_ALLOWED' });
      await db.query('ROLLBACK TO SAVEPOINT invalid_move');
      const unchanged = (await db.query('SELECT * FROM task WHERE id=$1', [t.id])).rows[0];
      expect(unchanged.version).toBe(1);
      expect(unchanged.state_id).toBe(t.state_id);
      const moved = (
        await db.query('SELECT * FROM move_task($1,1,$2)', [
          t.id,
          { stateId: state.id, responsibleUserId: ids.b },
        ])
      ).rows[0];
      expect(moved.version).toBe(2);
      expect(moved.state_id).toBe(state.id);
      expect(moved.responsible_id).toBe(ids.b);
      expect(
        (
          await db.query('SELECT array_agg(user_id) users FROM task_participant WHERE task_id=$1', [
            t.id,
          ])
        ).rows[0].users,
      ).toEqual([ids.c]);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT scenario');
    }
  });
});
test('API requires Responsible and rejects invalid mutations without SQL disclosure', async () => {
  const app = await buildApp();
  try {
    const cookie = await session(ids.a);
    const headers = { cookie, origin };
    const missing = await app.inject({
      method: 'POST',
      url: '/api/boards/30000000-0000-4000-8000-000000000002/tasks',
      headers,
      payload: { title: 'missing responsible' },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe('VALIDATION_FAILED');
    const stale = await app.inject({
      method: 'POST',
      url: '/api/tasks/50000000-0000-4000-8000-000000000001/move',
      headers,
      payload: { expectedVersion: 99, responsibleUserId: ids.b },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    const workers = await app.inject({
      url: '/api/boards/30000000-0000-4000-8000-000000000002/workers',
      headers: { cookie },
    });
    expect(workers.statusCode).toBe(200);
    expect(workers.json()[0]).toHaveProperty('usedWip');
    expect(JSON.stringify(workers.json())).not.toContain('title');
  } finally {
    await app.close();
  }
});
