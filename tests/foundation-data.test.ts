import { afterAll, expect, test } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { asActor, ids, origin, session } from './helpers';

afterAll(() => pool.end());

test('workspace data is shared, managers maintain it, and foreign workspace references are rejected', async () => {
  const app = await buildApp();
  const admin = await session(ids.a);
  const member = await session(ids.b);
  const name = `系统 ${crypto.randomUUID()}`;
  const records: { systems: string[]; projects: string[] } = { systems: [], projects: [] };
  const send = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
    cookie = admin,
  ) => app.inject({ method, url: `/api/workspaces/${path}`, headers: { cookie, origin }, payload });
  try {
    const system = await send('POST', `${ids.alpha}/data/systems`, { name });
    expect(system.statusCode).toBe(201);
    records.systems.push(system.json().id);
    const foreign = await send('POST', `${ids.beta}/data/systems`, { name });
    expect(foreign.statusCode).toBe(201);
    records.systems.push(foreign.json().id);
    const project = await send('POST', `${ids.alpha}/data/projects`, {
      name: '一期',
      systemId: system.json().id,
    });
    expect(project.statusCode).toBe(201);
    records.projects.push(project.json().id);

    const data = await send('GET', `${ids.alpha}/data`, undefined, member);
    expect(data.statusCode).toBe(200);
    expect(data.json().systems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: system.json().id })]),
    );
    expect(data.json().systems.some((s: { id: string }) => s.id === foreign.json().id)).toBe(false);
    expect(data.json().projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: project.json().id, system_id: system.json().id }),
      ]),
    );
    expect(
      (await send('POST', `${ids.alpha}/data/systems`, { name: '无权限' }, member)).statusCode,
    ).toBe(403);
    expect((await send('POST', `${ids.alpha}/data/systems`, { name: '  ' })).statusCode).toBe(422);
    expect(
      (
        await send('POST', `${ids.alpha}/data/projects`, {
          name: '错误空间',
          systemId: foreign.json().id,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await send('PATCH', `${ids.alpha}/data/projects/${project.json().id}`, {
          systemId: foreign.json().id,
        })
      ).statusCode,
    ).toBe(422);
    expect((await send('DELETE', `${ids.beta}/data/systems/${system.json().id}`)).statusCode).toBe(
      404,
    );
    expect((await send('DELETE', `${ids.alpha}/data/systems/${system.json().id}`)).statusCode).toBe(
      409,
    );

    const options = await app.inject({
      url: '/api/plugins/ops/boards/30000000-0000-4000-8000-000000000004/options',
      headers: { cookie: member },
    });
    expect(options.statusCode).toBe(200);
    expect(options.json().systems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: system.json().id })]),
    );
    expect(
      (
        await send('PATCH', `${ids.alpha}/data/projects/${project.json().id}`, { name: '二期' })
      ).json().name,
    ).toBe('二期');
    expect(
      (await send('DELETE', `${ids.alpha}/data/projects/${project.json().id}`)).statusCode,
    ).toBe(200);
    expect((await send('DELETE', `${ids.alpha}/data/systems/${system.json().id}`)).statusCode).toBe(
      200,
    );
  } finally {
    await pool.query('DELETE FROM workspace_project WHERE id=ANY($1::uuid[])', [records.projects]);
    await pool.query('DELETE FROM workspace_system WHERE id=ANY($1::uuid[])', [records.systems]);
    await app.close();
  }
});

test('both plugins reuse a system and R&D project/system pairing is enforced in the database', async () => {
  await asActor(ids.a, async (db) => {
    await db.query('SAVEPOINT foundation_data');
    try {
      const systems = (
        await db.query(
          'INSERT INTO workspace_system(workspace_id,name) VALUES($1,$3),($1,$4),($2,$3) RETURNING *',
          [ids.alpha, ids.beta, crypto.randomUUID(), crypto.randomUUID()],
        )
      ).rows;
      const [system, otherSystem, foreignSystem] = systems;
      const project = (
        await db.query(
          'INSERT INTO workspace_project(workspace_id,system_id,name) VALUES($1,$2,$3) RETURNING *',
          [ids.alpha, system.id, '项目'],
        )
      ).rows[0];
      const create = async (boardId: string) =>
        (
          await db.query('SELECT * FROM create_task($1,$2)', [
            boardId,
            { title: '共享依赖校验', responsibleUserId: ids.a },
          ])
        ).rows[0];
      const rnd = await create('30000000-0000-4000-8000-000000000002');
      const ops = await create('30000000-0000-4000-8000-000000000004');
      await db.query('SELECT set_rnd_task_fields($1,$2,$3)', [
        rnd.id,
        rnd.version,
        { system_id: system.id, project_id: project.id },
      ]);
      await db.query('SELECT set_ops_task_fields($1,$2,$3)', [
        ops.id,
        ops.version,
        { system_id: system.id },
      ]);
      expect(
        (await db.query('SELECT system_id FROM rnd_task_ext WHERE task_id=$1', [rnd.id])).rows[0]
          .system_id,
      ).toBe(system.id);
      expect(
        (await db.query('SELECT system_id FROM ops_task_ext WHERE task_id=$1', [ops.id])).rows[0]
          .system_id,
      ).toBe(system.id);
      for (const payload of [
        { system_id: otherSystem.id, project_id: project.id },
        { system_id: foreignSystem.id },
      ]) {
        await db.query('SAVEPOINT invalid_dependency');
        await expect(
          db.query('SELECT set_rnd_task_fields($1,$2,$3)', [rnd.id, rnd.version + 1, payload]),
        ).rejects.toThrow('VALIDATION_FAILED');
        await db.query('ROLLBACK TO SAVEPOINT invalid_dependency');
      }
      await db.query('SAVEPOINT foreign_ops');
      await expect(
        db.query('SELECT set_ops_task_fields($1,$2,$3)', [
          ops.id,
          ops.version + 1,
          { system_id: foreignSystem.id },
        ]),
      ).rejects.toThrow('VALIDATION_FAILED');
      await db.query('ROLLBACK TO SAVEPOINT foreign_ops');
      await db.query('SAVEPOINT direct_constraint');
      await expect(
        db.query('UPDATE rnd_task_ext SET system_id=$2 WHERE task_id=$1', [rnd.id, otherSystem.id]),
      ).rejects.toMatchObject({ code: '23503' });
      await db.query('ROLLBACK TO SAVEPOINT direct_constraint');
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT foundation_data');
    }
  });
});

test('legacy systems retain their IDs while legacy modules remain separate from projects', async () => {
  await asActor(ids.a, async (db) => {
    await db.query('SAVEPOINT legacy_foundation');
    try {
      const name = `兼容 ${crypto.randomUUID()}`;
      const rnd = (
        await db.query(
          "INSERT INTO rnd_system(workspace_id,board_id,name) VALUES($1,'30000000-0000-4000-8000-000000000002',$2) RETURNING *",
          [ids.alpha, name],
        )
      ).rows[0];
      const ops = (
        await db.query(
          "INSERT INTO ops_service(workspace_id,board_id,name) VALUES($1,'30000000-0000-4000-8000-000000000004',$2) RETURNING *",
          [ids.alpha, name],
        )
      ).rows[0];
      const module = (
        await db.query(
          "INSERT INTO rnd_module(workspace_id,board_id,system_id,name) VALUES($1,'30000000-0000-4000-8000-000000000002',$2,'旧模块') RETURNING *",
          [ids.alpha, rnd.id],
        )
      ).rows[0];
      expect(
        (
          await db.query('SELECT id FROM workspace_system WHERE id=ANY($1::uuid[])', [
            [rnd.id, ops.id],
          ])
        ).rowCount,
      ).toBe(2);
      expect(
        (await db.query('SELECT system_id FROM rnd_module WHERE id=$1', [module.id])).rows[0]
          .system_id,
      ).toBe(rnd.id);
      expect(
        (await db.query('SELECT 1 FROM workspace_project WHERE id=$1', [module.id])).rowCount,
      ).toBe(0);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT legacy_foundation');
    }
  });
});
