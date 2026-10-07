
BEGIN;CREATE EXTENSION IF NOT EXISTS pgtap;SELECT plan(8);
SELECT set_config('app.actor_id','10000000-0000-4000-8000-000000000002',true);
SELECT lives_ok($$SELECT require_plugin_enabled('20000000-0000-4000-8000-000000000001','rnd')$$,'R&D enabled in alpha');
SELECT throws_ok($$SELECT require_plugin_enabled('20000000-0000-4000-8000-000000000002','rnd')$$,'P0001','PLUGIN_NOT_ENABLED','R&D disabled in beta');
SELECT throws_ok($$SELECT set_workspace_plugin('20000000-0000-4000-8000-000000000001','rnd',false)$$,'P0001','PLUGIN_HAS_DEPENDENCIES','active board guards disable');
SELECT lives_ok($$SELECT set_rnd_task_fields('50000000-0000-4000-8000-000000000001',1,'{"module_id":"60000000-0000-4000-8000-000000000003"}')$$,'R&D extension mutation');
SELECT is((SELECT version FROM task WHERE id='50000000-0000-4000-8000-000000000001'),2,'plugin uses Core version');
SELECT throws_ok($$SELECT set_rnd_task_fields('50000000-0000-4000-8000-000000000001',1,'{}')$$,'P0001','VERSION_CONFLICT','plugin stale version');
SELECT throws_ok($$UPDATE rnd_lane_ext SET workspace_id='20000000-0000-4000-8000-000000000002',board_id='30000000-0000-4000-8000-000000000003' WHERE lane_id='40000000-0000-4000-8000-000000000001'$$,'23503',NULL,'lane extension cannot cross board');
SELECT is(wip_usage('10000000-0000-4000-8000-000000000002'),3,'R&D focus uses Core WIP');
SELECT * FROM finish();ROLLBACK;
