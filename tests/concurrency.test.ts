import { test, expect, afterAll } from 'vitest';
import { pool } from '../apps/api/src/lib/db';
import { ids, asActor } from './helpers';
import { coreTemplates } from '../packages/plugin-sdk/src';
afterAll(() => pool.end());
async function fixture() {
  const uid = crypto.randomUUID();
  const workspace = await asActor(ids.admin, async (db) => {
    await db.query('INSERT INTO app_user(id,feishu_open_id,display_name) VALUES($1,$2,$3)', [
      uid,
      `fixture-${uid}`,
      '并发测试成员',
    ]);
    const w = (
      await db.query('SELECT * FROM create_workspace($1,$2)', [
        `t${uid.slice(0, 8)}`,
        '并发测试空间',
      ])
    ).rows[0];
    await db.query("SELECT set_workspace_member($1,$2,'member','active')", [w.id, uid]);
    await db.query("SELECT set_workspace_member($1,$2,'member','active')", [w.id, ids.b]);
    return w;
  });
  return {
    uid,
    wid: workspace.id,
    async close() {
      await asActor(ids.admin, (db) =>
        db.query("UPDATE workspace SET status='archived' WHERE id=$1", [workspace.id]),
      );
    },
  };
}
test('Focus racing with every invalidating Task or scope mutation leaves no illegal Focus', async () => {
  const f = await fixture();
  try {
    for (const action of [
      'responsible',
      'participant',
      'state',
      'delete',
      'account',
      'membership',
      'access',
      'boardArchive',
      'boardRevoke',
    ]) {
      const b = (
        await asActor(ids.admin, (db) =>
          db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
            f.wid,
            `T${crypto.randomUUID().slice(0, 8)}`,
            action,
            action === 'boardRevoke' ? 'restricted' : 'workspace',
            coreTemplates[0],
          ]),
        )
      ).rows[0];
      if (action === 'boardRevoke')
        await asActor(ids.admin, (db) =>
          db.query("INSERT INTO board_member(board_id,user_id,role) VALUES($1,$2,'member')", [
            b.id,
            f.uid,
          ]),
        );
      const t = (
        await asActor(ids.admin, (db) =>
          db.query('SELECT * FROM create_task($1,$2)', [
            b.id,
            {
              title: action,
              responsibleUserId: action === 'participant' ? ids.b : f.uid,
              participantUserIds: action === 'participant' ? [f.uid] : undefined,
            },
          ]),
        )
      ).rows[0];
      const invalidate = () =>
        asActor(ids.admin, async (db) => {
          if (action === 'responsible')
            return db.query('SELECT set_task_responsible($1,$2,1)', [t.id, ids.b]);
          if (action === 'participant')
            return db.query('SELECT remove_task_participant($1,$2,1)', [t.id, f.uid]);
          if (action === 'state') {
            const s = (
              await db.query(
                "SELECT id FROM board_state WHERE board_id=$1 AND state_group='waiting'",
                [b.id],
              )
            ).rows[0];
            return db.query('SELECT move_task($1,1,$2)', [t.id, { stateId: s.id }]);
          }
          if (action === 'delete')
            return db.query('SELECT mutate_task($1,1,$2)', [t.id, { delete: true }]);
          if (action === 'account')
            return db.query("SELECT set_user_status($1,'deactivated')", [f.uid]);
          if (action === 'membership')
            return db.query("SELECT set_workspace_member($1,$2,'member','inactive')", [
              f.wid,
              f.uid,
            ]);
          await db.query('SELECT lock_workspace($1),lock_board($2,true)', [f.wid, b.id]);
          if (action === 'access')
            return db.query("UPDATE board SET access_mode='restricted' WHERE id=$1", [b.id]);
          if (action === 'boardArchive')
            return db.query("UPDATE board SET status='archived' WHERE id=$1", [b.id]);
          return db.query('DELETE FROM board_member WHERE board_id=$1 AND user_id=$2', [
            b.id,
            f.uid,
          ]);
        });
      const result = await Promise.allSettled([
        asActor(f.uid, (db) => db.query('SELECT focus_task($1,$2)', [f.uid, t.id])),
        invalidate(),
      ]);
      expect(result[1].status, action).toBe('fulfilled');
      expect(
        (
          await pool.query('SELECT count(*) FROM task_focus WHERE task_id=$1 AND user_id=$2', [
            t.id,
            f.uid,
          ])
        ).rows[0].count,
        action,
      ).toBe('0');
      expect(
        (
          await pool.query(
            'SELECT count(*) FROM task_focus WHERE NOT can_focus_task(user_id,task_id)',
          )
        ).rows[0].count,
      ).toBe('0');
      if (action === 'account')
        await asActor(ids.admin, (db) => db.query("SELECT set_user_status($1,'active')", [f.uid]));
      if (action === 'membership')
        await asActor(ids.admin, (db) =>
          db.query("SELECT set_workspace_member($1,$2,'member','active')", [f.wid, f.uid]),
        );
    }
  } finally {
    await f.close();
  }
});
test('account deactivation and concurrent owner promotion share account-status serialization', async () => {
  const f = await fixture();
  try {
    const result = await Promise.allSettled([
      asActor(ids.admin, (db) => db.query("SELECT set_user_status($1,'deactivated')", [f.uid])),
      asActor(ids.admin, (db) =>
        db.query("SELECT set_workspace_member($1,$2,'owner','active')", [f.wid, f.uid]),
      ),
    ]);
    expect(result[0].status).toBe('fulfilled');
    const account = (await pool.query('SELECT status FROM app_user WHERE id=$1', [f.uid])).rows[0];
    expect(account.status).toBe('deactivated');
    expect((await pool.query('SELECT effective_owner_count($1) n', [f.wid])).rows[0].n).toBe('1');
  } finally {
    await f.close();
  }
});
test('Workspace exclusive scope closes Task creation and Worker grants to a revoked member', async () => {
  const f = await fixture();
  const lock = await pool.connect();
  try {
    const b = (
      await asActor(ids.admin, (db) =>
        db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
          f.wid,
          `T${crypto.randomUUID().slice(0, 8)}`,
          'scope',
          'workspace',
          coreTemplates[0],
        ]),
      )
    ).rows[0];
    await lock.query('BEGIN');
    await lock.query("SELECT set_config('app.actor_id',$1,true)", [ids.admin]);
    await lock.query('SELECT lock_owner($1),lock_workspace($1,true)', [f.wid]);
    const creating = asActor(f.uid, (db) =>
      db.query('SELECT create_task($1,$2)', [
        b.id,
        { title: 'old scope', responsibleUserId: f.uid },
      ]),
    );
    const settled = creating.then(
      () => ({ ok: true }),
      (e) => ({ ok: false, code: e.message }),
    );
    await lock.query("SELECT set_workspace_member($1,$2,'member','inactive')", [f.wid, f.uid]);
    await lock.query('COMMIT');
    expect((await settled).ok).toBe(false);
    expect(
      (await pool.query('SELECT count(*) FROM task WHERE board_id=$1', [b.id])).rows[0].count,
    ).toBe('0');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await f.close();
  }
});
