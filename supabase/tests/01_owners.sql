
BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; SELECT plan(5);
SELECT set_config('app.actor_id','10000000-0000-4000-8000-000000000001',true);
SELECT is(effective_owner_count('20000000-0000-4000-8000-000000000001'),1::bigint,'seed has one effective owner');
SELECT throws_ok($$SELECT set_workspace_member('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','member','active')$$,'P0001','LAST_WORKSPACE_OWNER','last owner demotion blocked');
SELECT throws_ok($$SELECT set_user_status('10000000-0000-4000-8000-000000000001','deactivated')$$,'P0001','LAST_WORKSPACE_OWNER','last owner account deactivation blocked');
SELECT lives_ok($$SELECT set_workspace_member('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','owner','active')$$,'grant second owner');
SELECT is(effective_owner_count('20000000-0000-4000-8000-000000000001'),2::bigint,'two active accounts are owners');
SELECT * FROM finish(); ROLLBACK;
