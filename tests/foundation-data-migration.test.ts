import { readdir, readFile } from 'node:fs/promises';
import { afterAll, expect, test } from 'vitest';
import { pool } from '../apps/api/src/lib/db';

afterAll(() => pool.end());

test('legacy upgrade and later catalog writes survive names that occupy generated suffixes', async () => {
  const db = await pool.connect();
  const schema = `foundation_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migration = '20261104000000_unified_foundation_data.sql';
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const rndBoard = crypto.randomUUID();
  const opsBoard = crypto.randomUUID();
  const rndId = crypto.randomUUID();
  const opsId = crypto.randomUUID();
  const reservedId = crypto.randomUUID();
  const secondReservedId = crypto.randomUUID();
  const moduleId = crypto.randomUUID();
  const laneId = crypto.randomUUID();
  const longName = 'A'.repeat(100);
  const candidate = (id: string, attempt: number) => {
    const suffix = ` · ${id}${attempt === 1 ? '' : ` · ${attempt}`}`;
    return longName.slice(0, 100 - suffix.length) + suffix;
  };
  try {
    await db.query('BEGIN');
    // Recreate the old release in a transaction-local schema. Both old and new
    // migration scripts run exactly as shipped; public data is left untouched.
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query("SELECT set_config('search_path',$1,true)", [`${schema},public,extensions`]);
    for (const filename of (await readdir(directory))
      .filter((name) => name.endsWith('.sql') && name < migration)
      .sort()) {
      await db.query(await readFile(new URL(filename, directory), 'utf8'));
    }
    await db.query("INSERT INTO app_user(id,display_name) VALUES($1,'升级测试')", [userId]);
    await db.query(
      "INSERT INTO workspace(id,key,name,created_by) VALUES($1,'upgrade','升级测试',$2)",
      [workspaceId, userId],
    );
    await db.query(
      "INSERT INTO workspace_member(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [workspaceId, userId],
    );
    await db.query("SELECT set_config('app.actor_id',$1,true)", [userId]);
    await db.query(
      "INSERT INTO workspace_plugin(workspace_id,plugin_key,enabled_by) VALUES($1,'rnd',$2),($1,'ops',$2)",
      [workspaceId, userId],
    );
    await db.query(
      "INSERT INTO board(id,workspace_id,key,name,template_key,plugin_key,created_by) VALUES($1,$3,'RND','研发','rnd.development','rnd',$4),($2,$3,'OPS','运维','ops.operations','ops',$4)",
      [rndBoard, opsBoard, workspaceId, userId],
    );
    // Reserve the first two generated names as ordinary, valid legacy names.
    // Their timestamps make them import before the duplicate system names.
    await db.query(
      "INSERT INTO ops_service(id,workspace_id,board_id,name,created_at) VALUES($1,$3,$4,$5,'2000-01-01'),($2,$3,$4,$6,'2000-01-01')",
      [
        reservedId,
        secondReservedId,
        workspaceId,
        opsBoard,
        candidate(opsId, 1),
        candidate(opsId, 2),
      ],
    );
    await db.query(
      "INSERT INTO rnd_system(id,workspace_id,board_id,name,created_at) VALUES($1,$2,$3,$4,'2000-01-02')",
      [rndId, workspaceId, rndBoard, longName],
    );
    await db.query(
      "INSERT INTO ops_service(id,workspace_id,board_id,name,created_at) VALUES($1,$2,$3,$4,'2000-01-03')",
      [opsId, workspaceId, opsBoard, longName],
    );
    await db.query(
      'INSERT INTO rnd_module(id,workspace_id,board_id,system_id,name) VALUES($1,$2,$3,$4,$5)',
      [moduleId, workspaceId, rndBoard, rndId, '旧模块'],
    );
    await db.query(
      "INSERT INTO board_state(board_id,key,name,state_group,sort_order,is_initial) VALUES($1,'todo','待处理','unstarted',0,true)",
      [rndBoard],
    );
    await db.query(
      "INSERT INTO board_task_type(board_id,key,name,sort_order) VALUES($1,'task','任务',0)",
      [rndBoard],
    );
    const task = (
      await db.query('SELECT * FROM create_task($1,$2)', [
        rndBoard,
        { title: '旧任务', responsibleUserId: userId },
      ])
    ).rows[0];
    await db.query('SELECT set_rnd_task_fields($1,$2,$3)', [
      task.id,
      task.version,
      { system_id: rndId, module_id: moduleId },
    ]);
    await db.query(
      "INSERT INTO board_lane(id,board_id,key,name,sort_order) VALUES($1,$2,'legacy','旧项目泳道',0)",
      [laneId, rndBoard],
    );
    await db.query(
      "INSERT INTO rnd_lane_ext(lane_id,workspace_id,board_id,project_code,owner_id,start_date,target_end_date) VALUES($1,$2,$3,'LEGACY-01',$4,'2026-01-01','2026-06-01')",
      [laneId, workspaceId, rndBoard, userId],
    );

    await db.query(await readFile(new URL(migration, directory), 'utf8'));
    const imported = (await db.query('SELECT id,name FROM workspace_system ORDER BY id')).rows;
    expect(imported).toHaveLength(4);
    expect(new Set(imported.map((row) => row.name)).size).toBe(4);
    expect(imported.every((row) => Array.from(row.name).length <= 100)).toBe(true);
    expect(imported.find((row) => row.id === opsId)?.name).toBe(candidate(opsId, 3));
    expect(imported.find((row) => row.id === rndId)?.name).toBe(longName);
    expect(imported.find((row) => row.id === reservedId)?.name).toBe(candidate(opsId, 1));
    expect((await db.query('SELECT id FROM workspace_project')).rowCount).toBe(0);
    expect(
      (
        await db.query('SELECT system_id,module_id,project_id FROM rnd_task_ext WHERE task_id=$1', [
          task.id,
        ])
      ).rows[0],
    ).toEqual({ system_id: rndId, module_id: moduleId, project_id: null });
    expect(
      (await db.query('SELECT id,system_id,name FROM rnd_module WHERE id=$1', [moduleId])).rows[0],
    ).toEqual({ id: moduleId, system_id: rndId, name: '旧模块' });
    expect(
      (
        await db.query(
          'SELECT project_code,owner_id,start_date::text,target_end_date::text,project_id FROM rnd_lane_ext WHERE lane_id=$1',
          [laneId],
        )
      ).rows[0],
    ).toEqual({
      project_code: 'LEGACY-01',
      owner_id: userId,
      start_date: '2026-01-01',
      target_end_date: '2026-06-01',
      project_id: null,
    });

    await db.query('SAVEPOINT invalid_legacy_pair');
    await expect(
      db.query('SELECT set_rnd_task_fields($1,$2,$3)', [
        task.id,
        task.version + 1,
        { system_id: opsId, module_id: moduleId },
      ]),
    ).rejects.toThrow('VALIDATION_FAILED');
    await db.query('ROLLBACK TO SAVEPOINT invalid_legacy_pair');
    await db.query('SELECT set_rnd_task_fields($1,$2,$3)', [
      task.id,
      task.version + 1,
      { system_id: rndId, module_id: moduleId },
    ]);
    expect(
      (await db.query('SELECT module_id,project_id FROM rnd_task_ext WHERE task_id=$1', [task.id]))
        .rows[0],
    ).toEqual({ module_id: moduleId, project_id: null });
    const project = (
      await db.query(
        "INSERT INTO workspace_project(workspace_id,system_id,name) VALUES($1,$2,'明确关联的项目') RETURNING *",
        [workspaceId, rndId],
      )
    ).rows[0];
    await db.query('SELECT set_rnd_task_fields($1,$2,$3)', [
      task.id,
      task.version + 2,
      { project_id: project.id },
    ]);
    expect(
      (await db.query('SELECT module_id,project_id FROM rnd_task_ext WHERE task_id=$1', [task.id]))
        .rows[0],
    ).toEqual({ module_id: null, project_id: project.id });

    const mirrorId = crypto.randomUUID();
    await db.query('INSERT INTO workspace_system(workspace_id,name) VALUES($1,$2),($1,$3)', [
      workspaceId,
      candidate(mirrorId, 1),
      candidate(mirrorId, 2),
    ]);
    // The board already has the long base name, so an update (which also invokes
    // the mirror) exercises a rename onto an occupied base plus occupied suffixes.
    await db.query(
      "INSERT INTO ops_service(id,workspace_id,board_id,name) VALUES($1,$2,$3,'原名称')",
      [mirrorId, workspaceId, opsBoard],
    );
    const extraBoard = crypto.randomUUID();
    await db.query(
      "INSERT INTO board(id,workspace_id,key,name,template_key,created_by) VALUES($1,$2,'LEGACY','旧看板','core.general',$3)",
      [extraBoard, workspaceId, userId],
    );
    await db.query('UPDATE ops_service SET board_id=$2,name=$3 WHERE id=$1', [
      mirrorId,
      extraBoard,
      longName,
    ]);
    expect(
      (await db.query('SELECT name FROM workspace_system WHERE id=$1', [mirrorId])).rows[0].name,
    ).toBe(candidate(mirrorId, 3));
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});
