-- Keep the existing Feishu/API authorization boundary when hosted on CloudBase PG.
-- Scope is the Work Platform objects only; managed functions, extension objects,
-- auth/storage schemas and other projects in public are deliberately untouched.
-- Use an independent SQL migration/API role, never a gateway role as object owner.
DO $cloudbase_permissions$
DECLARE
  table_names text[] := ARRAY[
    'public.agent_auth_rate_limit',
    'public.agent_authorization',
    'public.agent_device_request',
    'public.agent_request_log',
    'public.agent_task_creation',
    'public.app_user',
    'public.audit_log',
    'public.auth_session',
    'public.board',
    'public.board_lane',
    'public.board_member',
    'public.board_public_share',
    'public.board_state',
    'public.board_task_type',
    'public.comment',
    'public.intake_request',
    'public.label',
    'public.milestone',
    'public.notification',
    'public.oauth_nonce',
    'public.ops_lane_ext',
    'public.ops_service',
    'public.ops_task_ext',
    'public.resource_link',
    'public.rnd_lane_ext',
    'public.rnd_module',
    'public.rnd_system',
    'public.rnd_task_ext',
    'public.schema_migrations',
    'public.task',
    'public.task_activity',
    'public.task_focus',
    'public.task_label',
    'public.task_participant',
    'public.task_state_transition',
    'public.task_work_log',
    'public.workspace',
    'public.workspace_member',
    'public.workspace_plugin',
    'public.workspace_project',
    'public.workspace_system'];
  function_signatures text[] := ARRAY[
    'public.active_admin(uuid)',
    'public.actor_id()',
    'public.add_task_participant(uuid,uuid,integer)',
    'public.agent_audit_context()',
    'public.audit_agent_authorization()',
    'public.audit_mutation()',
    'public.can_edit_board(uuid,uuid)',
    'public.can_edit_task(uuid,uuid)',
    'public.can_focus_task(uuid,uuid)',
    'public.can_manage_board(uuid,uuid)',
    'public.can_manage_workspace(uuid,uuid)',
    'public.can_read_board(uuid,uuid)',
    'public.can_read_task(uuid,uuid)',
    'public.can_work_task(uuid,uuid)',
    'public.check_initial_state()',
    'public.check_parent(uuid,uuid,uuid)',
    'public.check_workspace_owner()',
    'public.cleanup_focus(uuid,uuid,uuid,uuid)',
    'public.create_board(uuid,text,text,text,jsonb)',
    'public.create_intake(uuid,jsonb)',
    'public.create_task(uuid,jsonb)',
    'public.create_work_log(uuid,jsonb)',
    'public.create_workspace(text,text,text)',
    'public.decide_intake(uuid,boolean,jsonb)',
    'public.effective_owner_count(uuid)',
    'public.focus_final_check()',
    'public.focus_ids(uuid)',
    'public.focus_task(uuid,uuid,uuid)',
    'public.guard_board_member()',
    'public.guard_board_plugin()',
    'public.guard_board_scope()',
    'public.guard_focus_write()',
    'public.guard_lane_archive()',
    'public.guard_member()',
    'public.guard_membership_delete()',
    'public.guard_participant()',
    'public.guard_plugin_dependency()',
    'public.guard_state()',
    'public.guard_task()',
    'public.guard_user_status()',
    'public.guard_wip_limit()',
    'public.guard_work_log()',
    'public.guard_workspace_scope()',
    'public.initial_sort_key(integer)',
    'public.is_task_worker(uuid,uuid)',
    'public.is_worker_eligible(uuid,uuid)',
    'public.legacy_workspace_system_name(uuid,text,uuid)',
    'public.lock_account(uuid)',
    'public.lock_board(uuid,boolean)',
    'public.lock_board_users(uuid)',
    'public.lock_owner(uuid)',
    'public.lock_task_scope(uuid)',
    'public.lock_wip(uuid)',
    'public.lock_work_log_user(uuid)',
    'public.lock_workspace(uuid,boolean)',
    'public.mirror_legacy_foundation()',
    'public.move_task(uuid,integer,jsonb)',
    'public.mutate_task(uuid,integer,jsonb)',
    'public.mutate_work_log(uuid,uuid,integer,jsonb,boolean)',
    'public.normalize_legacy_plugin_data()',
    'public.participant_cleanup()',
    'public.raise_app_error(text)',
    'public.remove_task_participant(uuid,uuid,integer)',
    'public.reorder_task(uuid,text)',
    'public.require_board_manage(uuid)',
    'public.require_plugin_enabled(uuid,text)',
    'public.require_task_edit(uuid,integer)',
    'public.require_task_read(uuid)',
    'public.scope_focus_cleanup()',
    'public.set_ops_task_fields(uuid,integer,jsonb)',
    'public.set_rnd_task_fields(uuid,integer,jsonb)',
    'public.set_task_label(uuid,uuid,integer,boolean)',
    'public.set_task_parent(uuid,uuid,integer,jsonb)',
    'public.set_task_responsible(uuid,uuid,integer)',
    'public.set_user_status(uuid,text)',
    'public.set_wip_limit(uuid,integer)',
    'public.set_workspace_member(uuid,uuid,text,text)',
    'public.set_workspace_plugin(uuid,text,boolean)',
    'public.task_assignment_notification()',
    'public.task_change_log()',
    'public.task_plugin_fields(uuid)',
    'public.unfocus_task(uuid,uuid)',
    'public.user_owner_final()',
    'public.wip_usage(uuid)',
    'public.work_log_activity()',
    'public.worker_exclusivity()',
    'public.workspace_role(uuid,uuid)'];
  object_name text;
  column_names text;
  relation_id oid;
  function_id oid;
  sequence_id oid;
  gateway_role text;
  audience text;
BEGIN
  FOREACH object_name IN ARRAY table_names LOOP
    relation_id := to_regclass(object_name);
    IF relation_id IS NULL THEN
      RAISE EXCEPTION 'WORK_PLATFORM_TABLE_MISSING: %', object_name;
    END IF;
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO column_names
    FROM pg_attribute
    WHERE attrelid = relation_id AND attnum > 0 AND NOT attisdropped;
    FOREACH gateway_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role'] LOOP
      IF gateway_role <> 'PUBLIC' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = gateway_role) THEN
        CONTINUE;
      END IF;
      audience := CASE WHEN gateway_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(gateway_role) END;
      EXECUTE format('REVOKE ALL ON TABLE %s FROM %s', relation_id::regclass, audience);
      -- Table-level REVOKE leaves explicit column grants intact.
      IF column_names IS NOT NULL THEN
        EXECUTE format(
          'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$s FROM %3$s',
          column_names, relation_id::regclass, audience);
      END IF;
      IF gateway_role <> 'PUBLIC' AND (
          has_table_privilege(gateway_role, relation_id,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_any_column_privilege(gateway_role, relation_id, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
        RAISE EXCEPTION 'WORK_PLATFORM_GATEWAY_ROLE_HAS_ACCESS: use independent SQL migration/API roles (role %, object %)', gateway_role, object_name;
      END IF;
      -- Only identity/serial sequences owned by an application table are in scope.
      FOR sequence_id IN
        SELECT sequence.oid FROM pg_class sequence
        JOIN pg_depend dependency ON dependency.classid = 'pg_class'::regclass
          AND dependency.objid = sequence.oid
        WHERE sequence.relkind = 'S' AND dependency.refclassid = 'pg_class'::regclass
          AND dependency.refobjid = relation_id AND dependency.deptype IN ('a', 'i')
      LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %s', sequence_id::regclass, audience);
        IF gateway_role <> 'PUBLIC' AND has_sequence_privilege(gateway_role, sequence_id, 'USAGE,SELECT,UPDATE') THEN
          RAISE EXCEPTION 'WORK_PLATFORM_GATEWAY_ROLE_HAS_ACCESS: use independent SQL migration/API roles (role %, sequence %)', gateway_role, sequence_id::regclass;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH object_name IN ARRAY function_signatures LOOP
    function_id := to_regprocedure(object_name);
    IF function_id IS NULL THEN
      RAISE EXCEPTION 'WORK_PLATFORM_FUNCTION_MISSING: %', object_name;
    END IF;
    FOREACH gateway_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role'] LOOP
      IF gateway_role <> 'PUBLIC' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = gateway_role) THEN
        CONTINUE;
      END IF;
      audience := CASE WHEN gateway_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(gateway_role) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', function_id::regprocedure, audience);
      IF gateway_role <> 'PUBLIC' AND has_function_privilege(gateway_role, function_id, 'EXECUTE') THEN
        RAISE EXCEPTION 'WORK_PLATFORM_GATEWAY_ROLE_HAS_ACCESS: use independent SQL migration/API roles (role %, function %)', gateway_role, object_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$cloudbase_permissions$;
