
BEGIN;CREATE EXTENSION IF NOT EXISTS pgtap;SELECT plan(13);
SELECT set_config('app.actor_id','10000000-0000-4000-8000-000000000002',true);
SELECT ok(can_edit_task('10000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000001'),'unassigned member can edit');
SELECT ok(NOT can_focus_task('10000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000001'),'unassigned member cannot focus');
SELECT throws_ok($$UPDATE task SET state_group='completed' WHERE id='50000000-0000-4000-8000-000000000001'$$,'P0001','VALIDATION_FAILED','derived group cannot be forged');
SELECT throws_ok($$SELECT move_task('50000000-0000-4000-8000-000000000001',99,'{}')$$,'P0001','VERSION_CONFLICT','stale version rejected');
SELECT lives_ok($$SELECT move_task('50000000-0000-4000-8000-000000000001',1,'{"responsibleUserId":"10000000-0000-4000-8000-000000000003","laneId":"40000000-0000-4000-8000-000000000002"}')$$,'atomic responsible and lane move');
SELECT is((SELECT version FROM task WHERE id='50000000-0000-4000-8000-000000000001'),2,'one logical move bumps once');
SELECT is((SELECT count(*) FROM task_participant WHERE task_id='50000000-0000-4000-8000-000000000001'),1::bigint,'promotion only removes target participant');
SELECT throws_ok($$SELECT set_task_parent('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',2)$$,'P0001','VALIDATION_FAILED','cross board parent blocked');
SELECT lives_ok($$SELECT set_task_parent('50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001',1)$$,'valid child');
SELECT throws_ok($$SELECT set_task_parent('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',2)$$,'P0001','VALIDATION_FAILED','cycle blocked');
SELECT throws_ok($$UPDATE board_lane SET status='archived' WHERE id='40000000-0000-4000-8000-000000000002'$$,'P0001','LANE_HAS_ACTIVE_TASKS','active lane cannot archive');
SELECT lives_ok($$SELECT reorder_task('50000000-0000-4000-8000-000000000001','a2')$$,'reorder succeeds');
SELECT is((SELECT version FROM task WHERE id='50000000-0000-4000-8000-000000000001'),2,'reorder does not bump');
SELECT * FROM finish();ROLLBACK;
