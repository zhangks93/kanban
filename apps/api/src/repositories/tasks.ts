import type pg from 'pg';
import type { Task } from '@work/shared';
export const taskSelect = `SELECT t.*,b.key AS board_key,b.name AS board_name,w.key AS workspace_key,w.name AS workspace_name,ty.name AS type_name,u.display_name AS responsible_name,is_worker_eligible(t.responsible_id,t.board_id) AS responsible_eligible,can_edit_task($1,t.id) AS can_edit,can_focus_task($1,t.id) AS can_focus,focus_ids(t.id) AS focus_user_ids,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.user_id,'display_name',pu.display_name,'eligible',is_worker_eligible(p.user_id,t.board_id),'focused',p.user_id=ANY(focus_ids(t.id))) ORDER BY p.added_at) FROM task_participant p JOIN app_user pu ON pu.id=p.user_id WHERE p.task_id=t.id),'[]') AS participants,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name)) FROM task_label tl JOIN label l ON l.id=tl.label_id WHERE tl.task_id=t.id),'[]') AS labels,
 task_plugin_fields(t.id) AS plugin_fields
 FROM task t JOIN board b ON b.id=t.board_id JOIN workspace w ON w.id=t.workspace_id JOIN app_user u ON u.id=t.responsible_id JOIN board_task_type ty ON ty.id=t.type_id`;
export async function getTask(
  db: Pick<pg.PoolClient, 'query'>,
  actor: string,
  id: string,
): Promise<Task | null> {
  return (
    (await db.query(`${taskSelect} WHERE t.id=$2 AND can_read_task($1,t.id)`, [actor, id]))
      .rows[0] ?? null
  );
}
export async function listTasks(
  db: Pick<pg.PoolClient, 'query'>,
  actor: string,
  where: string,
  params: unknown[] = [],
) {
  return (
    await db.query(
      `${taskSelect} WHERE t.deleted_at IS NULL AND can_read_task($1,t.id) AND (${where}) ORDER BY t.sort_key,t.id LIMIT 2000`,
      [actor, ...params],
    )
  ).rows as Task[];
}
