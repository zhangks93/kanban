
CREATE TABLE task_focus(task_id uuid NOT NULL,workspace_id uuid NOT NULL,board_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES app_user,focused_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(task_id,user_id),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id));
CREATE INDEX focus_user ON task_focus(user_id);
CREATE OR REPLACE FUNCTION focus_ids(tid uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$SELECT coalesce(array_agg(user_id ORDER BY user_id),ARRAY[]::uuid[]) FROM task_focus WHERE task_id=tid$$;
CREATE FUNCTION wip_usage(uid uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT count(*)::integer FROM task_focus WHERE user_id=uid$$;
CREATE OR REPLACE FUNCTION cleanup_focus(wid uuid DEFAULT NULL,bid uuid DEFAULT NULL,tid uuid DEFAULT NULL,uid uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$DECLARE affected uuid;BEGIN
 IF current_setting('app.worker_conversion',true)='true' THEN RETURN;END IF;
 FOR affected IN SELECT DISTINCT f.user_id FROM task_focus f WHERE (wid IS NULL OR f.workspace_id=wid) AND (bid IS NULL OR f.board_id=bid) AND (tid IS NULL OR f.task_id=tid) AND (uid IS NULL OR f.user_id=uid) ORDER BY f.user_id LOOP PERFORM lock_wip(affected);END LOOP;
 PERFORM 1 FROM task t WHERE EXISTS(SELECT 1 FROM task_focus f WHERE f.task_id=t.id AND (wid IS NULL OR f.workspace_id=wid) AND (bid IS NULL OR f.board_id=bid) AND (tid IS NULL OR f.task_id=tid) AND (uid IS NULL OR f.user_id=uid)) ORDER BY t.id FOR UPDATE;
 DELETE FROM task_focus f WHERE (wid IS NULL OR f.workspace_id=wid) AND (bid IS NULL OR f.board_id=bid) AND (tid IS NULL OR f.task_id=tid) AND (uid IS NULL OR f.user_id=uid) AND NOT can_focus_task(f.user_id,f.task_id);
END$$;
CREATE FUNCTION guard_focus_write() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE t task;BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.task_id,NEW.workspace_id,NEW.board_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.task_id,OLD.workspace_id,OLD.board_id,OLD.user_id) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;SELECT * INTO t FROM task WHERE id=COALESCE(NEW.task_id,OLD.task_id);PERFORM lock_workspace(t.workspace_id);PERFORM lock_board(t.board_id);PERFORM lock_wip(COALESCE(NEW.user_id,OLD.user_id));
 IF TG_OP<>'DELETE' THEN
  IF NOT can_work_task(NEW.user_id,NEW.task_id) THEN PERFORM raise_app_error('TASK_NOT_WORKER');END IF;
  IF NOT can_focus_task(NEW.user_id,NEW.task_id) THEN PERFORM raise_app_error('TASK_NOT_FOCUSABLE');END IF;
  IF NOT EXISTS(SELECT 1 FROM task_focus WHERE task_id=NEW.task_id AND user_id=NEW.user_id) AND wip_usage(NEW.user_id)>=(SELECT wip_limit FROM app_user WHERE id=NEW.user_id) AND current_setting('app.wip_replace',true) IS DISTINCT FROM 'true' THEN PERFORM raise_app_error('WIP_CAPACITY_EXCEEDED');END IF;
 END IF;RETURN COALESCE(NEW,OLD);END$$;
CREATE TRIGGER focus_guard BEFORE INSERT OR UPDATE OR DELETE ON task_focus FOR EACH ROW EXECUTE FUNCTION guard_focus_write();
CREATE FUNCTION focus_final_check() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT 1 FROM task_focus WHERE task_id=NEW.task_id AND user_id=NEW.user_id) AND NOT can_focus_task(NEW.user_id,NEW.task_id) THEN PERFORM raise_app_error('TASK_NOT_FOCUSABLE');END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER focus_valid AFTER INSERT OR UPDATE ON task_focus DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION focus_final_check();
CREATE FUNCTION focus_task(uid uuid,target uuid,source uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE scope uuid;t task;u app_user;used integer;BEGIN
 IF actor_id() IS DISTINCT FROM uid THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 IF NOT EXISTS(SELECT 1 FROM task WHERE id=target) THEN PERFORM raise_app_error('NOT_FOUND');END IF;
 FOR scope IN SELECT DISTINCT workspace_id FROM task WHERE id=target OR id=source ORDER BY workspace_id LOOP PERFORM lock_workspace(scope);END LOOP;
 FOR scope IN SELECT DISTINCT board_id FROM task WHERE id=target OR id=source ORDER BY board_id LOOP PERFORM lock_board(scope);END LOOP;
 PERFORM lock_wip(uid);SELECT * INTO u FROM app_user WHERE id=uid FOR UPDATE;
 PERFORM 1 FROM task WHERE id=target OR id=source ORDER BY id FOR UPDATE;
 SELECT * INTO t FROM task WHERE id=target;
 IF u.status<>'active' THEN PERFORM raise_app_error('UNAUTHENTICATED');END IF;
 IF NOT can_work_task(uid,target) THEN PERFORM raise_app_error('TASK_NOT_WORKER');END IF;
 IF NOT can_focus_task(uid,target) THEN PERFORM raise_app_error('TASK_NOT_FOCUSABLE');END IF;
 IF EXISTS(SELECT 1 FROM task_focus WHERE task_id=target AND user_id=uid) THEN RETURN jsonb_build_object('usedWip',wip_usage(uid),'wipLimit',u.wip_limit);END IF;
 used:=wip_usage(uid);
 IF source IS NULL THEN IF used>=u.wip_limit THEN PERFORM raise_app_error('WIP_CAPACITY_EXCEEDED');END IF;
 ELSE
  IF source=target OR NOT EXISTS(SELECT 1 FROM task_focus WHERE task_id=source AND user_id=uid) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
  DELETE FROM task_focus WHERE task_id=source AND user_id=uid;
  PERFORM set_config('app.wip_replace','true',true);
 END IF;
 INSERT INTO task_focus(task_id,workspace_id,board_id,user_id) VALUES(target,t.workspace_id,t.board_id,uid);
 PERFORM set_config('app.wip_replace','false',true);
 RETURN jsonb_build_object('usedWip',wip_usage(uid),'wipLimit',u.wip_limit);END$$;
CREATE FUNCTION unfocus_task(uid uuid,tid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE t task;u app_user;BEGIN
 IF actor_id() IS DISTINCT FROM uid THEN PERFORM raise_app_error('FORBIDDEN');END IF;SELECT * INTO t FROM task WHERE id=tid;IF t.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;
 PERFORM lock_workspace(t.workspace_id);PERFORM lock_board(t.board_id);PERFORM lock_wip(uid);SELECT * INTO u FROM app_user WHERE id=uid FOR UPDATE;
 PERFORM 1 FROM task WHERE id=tid FOR UPDATE;IF NOT can_read_task(uid,tid) THEN PERFORM raise_app_error('NOT_FOUND');END IF;DELETE FROM task_focus WHERE task_id=tid AND user_id=uid;RETURN jsonb_build_object('usedWip',wip_usage(uid),'wipLimit',u.wip_limit);END$$;
CREATE FUNCTION set_wip_limit(uid uuid,p_limit integer) RETURNS app_user LANGUAGE plpgsql AS $$DECLARE u app_user;BEGIN IF NOT active_admin(actor_id()) THEN PERFORM raise_app_error('FORBIDDEN');END IF;PERFORM lock_wip(uid);SELECT * INTO u FROM app_user WHERE id=uid FOR UPDATE;IF u.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;UPDATE app_user SET wip_limit=p_limit WHERE id=uid RETURNING * INTO u;RETURN u;END$$;
CREATE FUNCTION guard_wip_limit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.wip_limit<>OLD.wip_limit THEN PERFORM lock_wip(NEW.id);END IF;RETURN NEW;END$$;
CREATE TRIGGER wip_limit_guard BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION guard_wip_limit();
