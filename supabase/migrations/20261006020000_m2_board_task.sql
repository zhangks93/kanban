
CREATE TABLE board (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspace,key text NOT NULL,name text NOT NULL,description text,
 access_mode text NOT NULL DEFAULT 'workspace' CHECK(access_mode IN('workspace','restricted')),template_key text NOT NULL,plugin_key text,
 lane_mode text NOT NULL DEFAULT 'none' CHECK(lane_mode IN('none','manual')),status text NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
 start_date date,target_end_date date,intake_enabled boolean NOT NULL DEFAULT false,task_seq integer NOT NULL DEFAULT 0,created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,key),UNIQUE(id,workspace_id)
);
CREATE TABLE board_member(board_id uuid REFERENCES board,user_id uuid REFERENCES app_user,role text NOT NULL CHECK(role IN('lead','member','viewer')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(board_id,user_id));
CREATE TABLE board_state(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES board,key text NOT NULL,name text NOT NULL,state_group text NOT NULL CHECK(state_group IN('backlog','unstarted','started','waiting','completed','cancelled')),sort_order integer NOT NULL,is_initial boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(board_id,key),UNIQUE(id,board_id),UNIQUE(id,board_id,state_group));
CREATE UNIQUE INDEX one_initial_state ON board_state(board_id) WHERE is_initial;
CREATE TABLE board_lane(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES board,key text NOT NULL,name text NOT NULL,description text,sort_order integer NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(board_id,key),UNIQUE(id,board_id));
CREATE TABLE board_task_type(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES board,key text NOT NULL,name text NOT NULL,plugin_key text,is_container boolean NOT NULL DEFAULT false,sort_order integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(board_id,key),UNIQUE(id,board_id));
CREATE TABLE milestone(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES board,name text NOT NULL,due_date date NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reached')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,board_id));
CREATE TABLE label(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),board_id uuid NOT NULL REFERENCES board,name text NOT NULL,color text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(board_id,name),UNIQUE(id,board_id));
CREATE TABLE task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,board_id uuid NOT NULL,lane_id uuid,seq integer NOT NULL,
 title text NOT NULL CHECK(char_length(trim(title)) BETWEEN 1 AND 255),description jsonb,description_text text,type_id uuid NOT NULL,responsible_id uuid NOT NULL REFERENCES app_user,
 requester_id uuid REFERENCES app_user,reporter_id uuid NOT NULL REFERENCES app_user,state_id uuid NOT NULL,state_group text NOT NULL,
 priority text NOT NULL DEFAULT 'none' CHECK(priority IN('urgent','high','medium','low','none')),start_date date,due_date date,milestone_id uuid,parent_id uuid,
 started_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,last_activity_at timestamptz NOT NULL DEFAULT now(),sort_key text COLLATE "C" NOT NULL DEFAULT 'a0',version integer NOT NULL DEFAULT 1,
 client_mutation_id uuid,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(board_id,seq),UNIQUE(id,board_id,workspace_id),UNIQUE(id,board_id),
 FOREIGN KEY(board_id,workspace_id) REFERENCES board(id,workspace_id),FOREIGN KEY(state_id,board_id,state_group) REFERENCES board_state(id,board_id,state_group),
 FOREIGN KEY(type_id,board_id) REFERENCES board_task_type(id,board_id),FOREIGN KEY(lane_id,board_id) REFERENCES board_lane(id,board_id),FOREIGN KEY(milestone_id,board_id) REFERENCES milestone(id,board_id),FOREIGN KEY(parent_id,board_id) REFERENCES task(id,board_id)
);
CREATE UNIQUE INDEX task_client_id ON task(reporter_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL;
CREATE INDEX task_board_cell ON task(board_id,state_id,lane_id,sort_key) WHERE deleted_at IS NULL;
CREATE INDEX task_responsible ON task(responsible_id) WHERE deleted_at IS NULL;
CREATE INDEX task_search ON task USING gin ((title||' '||coalesce(description_text,'')) gin_trgm_ops);
CREATE TABLE task_participant(task_id uuid NOT NULL,workspace_id uuid NOT NULL,board_id uuid NOT NULL,user_id uuid REFERENCES app_user,added_by uuid NOT NULL REFERENCES app_user,added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(task_id,user_id),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id));
CREATE INDEX participant_user ON task_participant(user_id,task_id);
CREATE TABLE task_label(task_id uuid,board_id uuid,label_id uuid,PRIMARY KEY(task_id,label_id),FOREIGN KEY(task_id,board_id) REFERENCES task(id,board_id),FOREIGN KEY(label_id,board_id) REFERENCES label(id,board_id));
CREATE TABLE comment(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,board_id uuid NOT NULL,task_id uuid NOT NULL,author_id uuid NOT NULL REFERENCES app_user,body jsonb NOT NULL,edited_at timestamptz,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id));
CREATE TABLE resource_link(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,board_id uuid NOT NULL,task_id uuid,url text NOT NULL,title text NOT NULL,kind text NOT NULL,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(board_id,workspace_id) REFERENCES board(id,workspace_id),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id));
CREATE TABLE task_activity(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL,board_id uuid NOT NULL,task_id uuid NOT NULL,actor_id uuid REFERENCES app_user,action text NOT NULL,field text,old_value jsonb,new_value jsonb,occurred_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id));
CREATE TABLE task_state_transition(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL,board_id uuid NOT NULL,task_id uuid NOT NULL,from_state_id uuid,to_state_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,occurred_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id),FOREIGN KEY(from_state_id,board_id) REFERENCES board_state(id,board_id),FOREIGN KEY(to_state_id,board_id) REFERENCES board_state(id,board_id));
CREATE FUNCTION lock_board(bid uuid,exclusive boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF exclusive THEN PERFORM pg_advisory_xact_lock(hashtextextended('scope:board:'||bid::text,0));ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('scope:board:'||bid::text,0));END IF;END$$;
CREATE FUNCTION lock_task_scope(tid uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE t task;BEGIN SELECT * INTO t FROM task WHERE id=tid;IF t.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;PERFORM lock_workspace(t.workspace_id);PERFORM lock_board(t.board_id);END$$;
CREATE FUNCTION lock_board_users(bid uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE uid uuid;BEGIN
 -- Conservative superset avoids discovering stale Worker/Focus sets while sibling Task mutations run under shared scope.
 FOR uid IN SELECT m.user_id FROM workspace_member m JOIN board b ON b.workspace_id=m.workspace_id WHERE b.id=bid ORDER BY m.user_id LOOP PERFORM lock_wip(uid);END LOOP;
END$$;
CREATE FUNCTION can_read_board(uid uuid,bid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM board b JOIN workspace w ON w.id=b.workspace_id JOIN workspace_member m ON m.workspace_id=w.id AND m.user_id=uid JOIN app_user u ON u.id=uid WHERE b.id=bid AND b.status='active' AND w.status='active' AND m.status='active' AND u.status='active' AND (b.access_mode='workspace' OR m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM board_member bm WHERE bm.board_id=bid AND bm.user_id=uid)))$$;
CREATE FUNCTION can_edit_board(uid uuid,bid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT can_read_board(uid,bid) AND EXISTS(SELECT 1 FROM board b WHERE b.id=bid AND (b.access_mode='workspace' OR workspace_role(uid,b.workspace_id) IN('owner','admin') OR EXISTS(SELECT 1 FROM board_member bm WHERE bm.board_id=bid AND bm.user_id=uid AND bm.role IN('lead','member'))))$$;
CREATE FUNCTION can_manage_board(uid uuid,bid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT can_read_board(uid,bid) AND EXISTS(SELECT 1 FROM board b WHERE b.id=bid AND (workspace_role(uid,b.workspace_id) IN('owner','admin') OR EXISTS(SELECT 1 FROM board_member bm WHERE bm.board_id=bid AND bm.user_id=uid AND bm.role='lead')))$$;
CREATE FUNCTION can_read_task(uid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM task t WHERE t.id=tid AND t.deleted_at IS NULL AND can_read_board(uid,t.board_id))$$;
CREATE FUNCTION can_edit_task(uid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM task t WHERE t.id=tid AND t.deleted_at IS NULL AND can_edit_board(uid,t.board_id))$$;
CREATE FUNCTION is_worker_eligible(uid uuid,bid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM board b WHERE b.id=bid AND can_read_board(uid,bid) AND (b.access_mode='workspace' OR EXISTS(SELECT 1 FROM board_member bm WHERE bm.board_id=bid AND bm.user_id=uid AND bm.role IN('lead','member'))))$$;
CREATE FUNCTION is_task_worker(uid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM task WHERE id=tid AND responsible_id=uid) OR EXISTS(SELECT 1 FROM task_participant WHERE task_id=tid AND user_id=uid)$$;
CREATE FUNCTION can_work_task(uid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT can_read_task(uid,tid) AND is_task_worker(uid,tid) AND EXISTS(SELECT 1 FROM task WHERE id=tid AND is_worker_eligible(uid,board_id))$$;
CREATE FUNCTION can_focus_task(uid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT can_work_task(uid,tid) AND EXISTS(SELECT 1 FROM task WHERE id=tid AND state_group NOT IN('waiting','completed','cancelled'))$$;
-- M3 replaces this no-op with synchronous Focus cleanup. All mutation boundaries are already fixed.
CREATE FUNCTION cleanup_focus(wid uuid DEFAULT NULL,bid uuid DEFAULT NULL,tid uuid DEFAULT NULL,uid uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION require_task_edit(tid uuid,expected integer) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;BEGIN
 PERFORM lock_task_scope(tid);SELECT * INTO t FROM task WHERE id=tid;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-tree:'||t.board_id::text,0));PERFORM lock_board_users(t.board_id);
 SELECT * INTO t FROM task WHERE id=tid FOR UPDATE;
 IF NOT can_edit_task(actor_id(),tid) THEN PERFORM raise_app_error('NOT_FOUND');END IF;
 IF t.version<>expected THEN PERFORM raise_app_error('VERSION_CONFLICT');END IF;RETURN t;END$$;
CREATE FUNCTION check_parent(tid uuid,bid uuid,pid uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE ancestor_depth integer;subtree_height integer;cycle_found boolean;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('task-tree:'||bid::text,0));
 IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task WHERE id=pid AND board_id=bid AND deleted_at IS NULL) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 WITH RECURSIVE ancestors AS(SELECT id,parent_id,1 AS d,ARRAY[id] AS path FROM task WHERE id=pid UNION ALL SELECT t.id,t.parent_id,a.d+1,a.path||t.id FROM task t JOIN ancestors a ON a.parent_id=t.id WHERE NOT t.id=ANY(a.path)) SELECT coalesce(max(d),0),coalesce(bool_or(id=tid),false) INTO ancestor_depth,cycle_found FROM ancestors;
 IF pid=tid OR cycle_found THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 WITH RECURSIVE descendants AS(SELECT tid AS id,1 AS d,ARRAY[tid] AS path UNION ALL SELECT t.id,d.d+1,d.path||t.id FROM task t JOIN descendants d ON t.parent_id=d.id WHERE NOT t.id=ANY(d.path)) SELECT coalesce(max(d),1) INTO subtree_height FROM descendants;
 IF ancestor_depth+subtree_height>3 THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
END$$;
CREATE FUNCTION guard_task() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE grp text;BEGIN
 PERFORM lock_workspace(NEW.workspace_id);PERFORM lock_board(NEW.board_id);
 IF TG_OP='UPDATE' AND (NEW.board_id<>OLD.board_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.seq<>OLD.seq) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 SELECT state_group INTO grp FROM board_state WHERE id=NEW.state_id AND board_id=NEW.board_id;
 IF grp IS NULL THEN PERFORM raise_app_error('INVALID_TRANSITION');END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state_group IS NOT NULL AND NEW.state_group<>grp THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;NEW.state_group:=grp;
  IF NOT is_worker_eligible(NEW.responsible_id,NEW.board_id) THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
  PERFORM check_parent(NEW.id,NEW.board_id,NEW.parent_id);
 ELSE
  IF NEW.state_id<>OLD.state_id THEN NEW.state_group:=grp;ELSIF NEW.state_group<>grp THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
  IF NEW.responsible_id<>OLD.responsible_id AND NOT is_worker_eligible(NEW.responsible_id,NEW.board_id) THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN PERFORM check_parent(NEW.id,NEW.board_id,NEW.parent_id);END IF;
  IF ROW(NEW.title,NEW.description,NEW.state_id,NEW.responsible_id,NEW.priority,NEW.start_date,NEW.due_date,NEW.milestone_id,NEW.type_id,NEW.parent_id,NEW.lane_id,NEW.deleted_at) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.state_id,OLD.responsible_id,OLD.priority,OLD.start_date,OLD.due_date,OLD.milestone_id,OLD.type_id,OLD.parent_id,OLD.lane_id,OLD.deleted_at) THEN NEW.version:=OLD.version+1;NEW.last_activity_at:=now();END IF;
 END IF;
 IF NEW.lane_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.lane_id IS DISTINCT FROM OLD.lane_id) AND NOT EXISTS(SELECT 1 FROM board b JOIN board_lane l ON l.board_id=b.id WHERE b.id=NEW.board_id AND b.lane_mode='manual' AND l.id=NEW.lane_id AND l.status='active') THEN PERFORM raise_app_error('LANE_NOT_ALLOWED');END IF;
 IF NEW.state_group='started' THEN NEW.started_at:=coalesce(NEW.started_at,now());END IF;
 IF NEW.state_group='completed' THEN NEW.completed_at:=coalesce(NEW.completed_at,now());END IF;
 IF NEW.state_group='cancelled' THEN NEW.cancelled_at:=coalesce(NEW.cancelled_at,now());END IF;
 NEW.updated_at:=now();RETURN NEW;END$$;
CREATE TRIGGER guard_task_write BEFORE INSERT OR UPDATE ON task FOR EACH ROW EXECUTE FUNCTION guard_task();
CREATE FUNCTION task_change_log() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 PERFORM cleanup_focus(NULL,NULL,NEW.id,NULL);
 IF TG_OP='INSERT' THEN INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action,new_value) VALUES(NEW.workspace_id,NEW.board_id,NEW.id,actor_id(),'created',to_jsonb(NEW));
 ELSIF NEW.version<>OLD.version THEN
 INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action,old_value,new_value) VALUES(NEW.workspace_id,NEW.board_id,NEW.id,actor_id(),CASE WHEN NEW.deleted_at IS NOT NULL THEN 'deleted' ELSE 'updated' END,to_jsonb(OLD),to_jsonb(NEW));
 IF NEW.deleted_at IS NOT NULL THEN INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,before,after) VALUES(NEW.workspace_id,actor_id(),'task.delete','task',NEW.id,to_jsonb(OLD),to_jsonb(NEW));END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.state_id<>OLD.state_id THEN INSERT INTO task_state_transition(workspace_id,board_id,task_id,from_state_id,to_state_id,actor_id) VALUES(NEW.workspace_id,NEW.board_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.state_id END,NEW.state_id,coalesce(actor_id(),NEW.reporter_id));END IF;RETURN NULL;END$$;
CREATE TRIGGER task_log AFTER INSERT OR UPDATE ON task FOR EACH ROW EXECUTE FUNCTION task_change_log();
CREATE FUNCTION guard_participant() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE t task;BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.task_id,NEW.workspace_id,NEW.board_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.task_id,OLD.workspace_id,OLD.board_id,OLD.user_id) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;SELECT * INTO t FROM task WHERE id=COALESCE(NEW.task_id,OLD.task_id);PERFORM lock_workspace(t.workspace_id);PERFORM lock_board(t.board_id);
 IF TG_OP<>'DELETE' AND NOT is_worker_eligible(NEW.user_id,t.board_id) THEN PERFORM raise_app_error('PARTICIPANT_NOT_ALLOWED');END IF;RETURN COALESCE(NEW,OLD);END$$;
CREATE TRIGGER guard_participant_write BEFORE INSERT OR UPDATE OR DELETE ON task_participant FOR EACH ROW EXECUTE FUNCTION guard_participant();
CREATE FUNCTION worker_exclusivity() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE tid uuid;BEGIN
 IF TG_TABLE_NAME='task' THEN tid:=NEW.id;ELSE tid:=COALESCE(NEW.task_id,OLD.task_id);END IF;
 IF EXISTS(SELECT 1 FROM task_participant p JOIN task t ON t.id=p.task_id WHERE t.id=tid AND t.responsible_id=p.user_id) THEN PERFORM raise_app_error('PARTICIPANT_NOT_ALLOWED');END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER task_worker_unique AFTER INSERT OR UPDATE ON task DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worker_exclusivity();
CREATE CONSTRAINT TRIGGER participant_worker_unique AFTER INSERT OR UPDATE ON task_participant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION worker_exclusivity();
CREATE FUNCTION participant_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM cleanup_focus(NULL,NULL,COALESCE(NEW.task_id,OLD.task_id),NULL);RETURN NULL;END$$;
CREATE TRIGGER participant_cleanup_after AFTER INSERT OR UPDATE OR DELETE ON task_participant FOR EACH ROW EXECUTE FUNCTION participant_cleanup();
CREATE FUNCTION guard_board_scope() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 PERFORM lock_workspace(NEW.workspace_id);IF TG_OP='UPDATE' AND (NEW.status<>OLD.status OR NEW.access_mode<>OLD.access_mode) THEN PERFORM lock_board(NEW.id,true);ELSE PERFORM lock_board(NEW.id);END IF;
 IF TG_OP='UPDATE' AND (NEW.workspace_id<>OLD.workspace_id OR (NEW.lane_mode='none' AND EXISTS(SELECT 1 FROM task WHERE board_id=NEW.id AND lane_id IS NOT NULL))) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;RETURN NEW;END$$;
CREATE TRIGGER board_scope BEFORE INSERT OR UPDATE ON board FOR EACH ROW EXECUTE FUNCTION guard_board_scope();
CREATE FUNCTION guard_board_member() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE b board;uid uuid;BEGIN IF TG_OP='UPDATE' AND (NEW.board_id<>OLD.board_id OR NEW.user_id<>OLD.user_id) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;SELECT * INTO b FROM board WHERE id=COALESCE(NEW.board_id,OLD.board_id);uid:=COALESCE(NEW.user_id,OLD.user_id);PERFORM lock_workspace(b.workspace_id);PERFORM lock_board(b.id,true);
 IF TG_OP<>'DELETE' AND NOT EXISTS(SELECT 1 FROM workspace_member WHERE workspace_id=b.workspace_id AND user_id=uid) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;RETURN COALESCE(NEW,OLD);END$$;
CREATE TRIGGER board_member_scope BEFORE INSERT OR UPDATE OR DELETE ON board_member FOR EACH ROW EXECUTE FUNCTION guard_board_member();
CREATE FUNCTION scope_focus_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_TABLE_NAME='workspace' THEN IF NEW.status=OLD.status THEN RETURN NULL;END IF;PERFORM cleanup_focus(NEW.id,NULL,NULL,NULL);
 ELSIF TG_TABLE_NAME='board' THEN IF NEW.status=OLD.status AND NEW.access_mode=OLD.access_mode THEN RETURN NULL;END IF;PERFORM cleanup_focus(NULL,NEW.id,NULL,NULL);
 ELSIF TG_TABLE_NAME='workspace_member' THEN PERFORM cleanup_focus(COALESCE(NEW.workspace_id,OLD.workspace_id),NULL,NULL,NULL);
 ELSIF TG_TABLE_NAME='board_member' THEN PERFORM cleanup_focus(NULL,COALESCE(NEW.board_id,OLD.board_id),NULL,NULL);
 ELSE IF NEW.status=OLD.status THEN RETURN NULL;END IF;PERFORM cleanup_focus(NULL,NULL,NULL,NEW.id);END IF;RETURN NULL;END$$;
CREATE TRIGGER cleanup_workspace AFTER UPDATE ON workspace FOR EACH ROW EXECUTE FUNCTION scope_focus_cleanup();
CREATE TRIGGER cleanup_board AFTER UPDATE ON board FOR EACH ROW EXECUTE FUNCTION scope_focus_cleanup();
CREATE TRIGGER cleanup_workspace_member AFTER UPDATE OR DELETE ON workspace_member FOR EACH ROW EXECUTE FUNCTION scope_focus_cleanup();
CREATE TRIGGER cleanup_board_member AFTER UPDATE OR DELETE ON board_member FOR EACH ROW EXECUTE FUNCTION scope_focus_cleanup();
CREATE TRIGGER cleanup_user AFTER UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION scope_focus_cleanup();
CREATE FUNCTION guard_workspace_scope() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM lock_workspace(NEW.id,true);RETURN NEW;END$$;
CREATE TRIGGER workspace_scope BEFORE UPDATE ON workspace FOR EACH ROW EXECUTE FUNCTION guard_workspace_scope();
CREATE FUNCTION guard_state() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF TG_OP='UPDATE' AND NEW.state_group<>OLD.state_group THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;RETURN NEW;END$$;
CREATE TRIGGER state_immutable BEFORE UPDATE ON board_state FOR EACH ROW EXECUTE FUNCTION guard_state();
CREATE FUNCTION check_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE bid uuid;BEGIN IF TG_TABLE_NAME='board' THEN bid:=NEW.id;ELSE bid:=COALESCE(NEW.board_id,OLD.board_id);END IF;IF EXISTS(SELECT 1 FROM board WHERE id=bid) AND NOT EXISTS(SELECT 1 FROM board_state WHERE board_id=bid AND is_initial) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER initial_board AFTER INSERT ON board DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_initial_state();
CREATE CONSTRAINT TRIGGER initial_state AFTER INSERT OR UPDATE OR DELETE ON board_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_initial_state();
CREATE FUNCTION guard_lane_archive() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 PERFORM lock_workspace((SELECT workspace_id FROM board WHERE id=NEW.board_id));PERFORM lock_board(NEW.board_id,true);
 IF NEW.status='archived' AND EXISTS(SELECT 1 FROM task WHERE lane_id=NEW.id AND deleted_at IS NULL AND state_group NOT IN('completed','cancelled')) THEN PERFORM raise_app_error('LANE_HAS_ACTIVE_TASKS');END IF;RETURN NEW;END$$;
CREATE TRIGGER lane_archive BEFORE UPDATE ON board_lane FOR EACH ROW EXECUTE FUNCTION guard_lane_archive();
CREATE FUNCTION create_board(wid uuid,p_key text,p_name text,p_access text,p_template jsonb) RETURNS board LANGUAGE plpgsql AS $$DECLARE b board;s jsonb;i integer:=0;BEGIN
 PERFORM lock_workspace(wid,true);IF NOT can_manage_workspace(actor_id(),wid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 INSERT INTO board(workspace_id,key,name,access_mode,template_key,plugin_key,lane_mode,created_by) VALUES(wid,p_key,p_name,p_access,p_template->>'key',p_template->>'pluginKey',p_template->>'laneMode',actor_id()) RETURNING * INTO b;
 FOR s IN SELECT * FROM jsonb_array_elements(p_template->'states') LOOP INSERT INTO board_state(board_id,key,name,state_group,sort_order,is_initial) VALUES(b.id,s->>'key',s->>'name',s->>'group',i,i=0);i:=i+1;END LOOP;i:=0;
 FOR s IN SELECT * FROM jsonb_array_elements(p_template->'taskTypes') LOOP INSERT INTO board_task_type(board_id,key,name,plugin_key,is_container,sort_order) VALUES(b.id,s->>'key',s->>'name',b.plugin_key,coalesce((s->>'isContainer')::boolean,false),i);i:=i+1;END LOOP;
 INSERT INTO board_member VALUES(b.id,actor_id(),'lead',now(),now());
 FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_template->'defaultLanes','[]')) LOOP INSERT INTO board_lane(board_id,key,name,sort_order) VALUES(b.id,s->>'key',s->>'name',i);i:=i+1;END LOOP;RETURN b;END$$;

CREATE FUNCTION initial_sort_key(n integer) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$DECLARE digits text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';value integer:=n;result text:='';BEGIN LOOP result:=substr(digits,(value%62)+1,1)||result;value:=value/62;EXIT WHEN value=0;END LOOP;RETURN chr(ascii('a')+length(result)-1)||result;END$$;

CREATE FUNCTION create_task(bid uuid,p jsonb) RETURNS task LANGUAGE plpgsql AS $$DECLARE b board;t task;sid uuid;typ uuid;uid uuid;BEGIN
 SELECT * INTO b FROM board WHERE id=bid;IF b.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;
 PERFORM lock_workspace(b.workspace_id);PERFORM lock_board(bid);IF p->>'clientMutationId' IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('task-client:'||actor_id()::text||':'||(p->>'clientMutationId'),0));END IF;PERFORM pg_advisory_xact_lock(hashtextextended('task-tree:'||bid::text,0));
 IF NOT can_edit_board(actor_id(),bid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 IF p->>'clientMutationId' IS NOT NULL THEN SELECT * INTO t FROM task WHERE reporter_id=actor_id() AND client_mutation_id=(p->>'clientMutationId')::uuid;IF t.id IS NOT NULL THEN RETURN t;END IF;END IF;
 IF NOT is_worker_eligible((p->>'responsibleUserId')::uuid,bid) THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
 sid:=coalesce((p->>'stateId')::uuid,(SELECT id FROM board_state WHERE board_id=bid AND is_initial));typ:=coalesce((p->>'typeId')::uuid,(SELECT id FROM board_task_type WHERE board_id=bid ORDER BY sort_order LIMIT 1));
 UPDATE board SET task_seq=task_seq+1 WHERE id=bid RETURNING task_seq INTO b.task_seq;
 INSERT INTO task(workspace_id,board_id,lane_id,seq,title,description,description_text,type_id,responsible_id,requester_id,reporter_id,state_id,state_group,priority,start_date,due_date,milestone_id,parent_id,sort_key,client_mutation_id)
 VALUES(b.workspace_id,bid,(p->>'laneId')::uuid,b.task_seq,p->>'title',p->'description',p->>'descriptionText',typ,(p->>'responsibleUserId')::uuid,(p->>'requesterId')::uuid,actor_id(),sid,(SELECT state_group FROM board_state WHERE id=sid),coalesce(p->>'priority','none'),(p->>'startDate')::date,(p->>'dueDate')::date,(p->>'milestoneId')::uuid,(p->>'parentId')::uuid,coalesce(p->>'sortKey',initial_sort_key(b.task_seq)),(p->>'clientMutationId')::uuid) RETURNING * INTO t;
 FOR uid IN SELECT jsonb_array_elements_text(coalesce(p->'participantUserIds','[]'))::uuid LOOP INSERT INTO task_participant(task_id,workspace_id,board_id,user_id,added_by) VALUES(t.id,b.workspace_id,bid,uid,actor_id());END LOOP;RETURN t;END$$;
CREATE FUNCTION mutate_task(tid uuid,expected integer,p jsonb) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;new_responsible uuid;BEGIN
 t:=require_task_edit(tid,expected);new_responsible:=coalesce((p->>'responsibleUserId')::uuid,t.responsible_id);
 IF new_responsible<>t.responsible_id THEN
  IF NOT is_worker_eligible(new_responsible,t.board_id) THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
  PERFORM set_config('app.worker_conversion','true',true);
  DELETE FROM task_participant WHERE task_id=tid AND user_id=new_responsible;
  PERFORM set_config('app.worker_conversion','false',true);
 END IF;
 IF p ? 'parentId' THEN PERFORM check_parent(tid,t.board_id,(p->>'parentId')::uuid);END IF;
 UPDATE task SET title=coalesce(p->>'title',title),description=CASE WHEN p?'description' THEN p->'description' ELSE description END,description_text=CASE WHEN p?'descriptionText' THEN p->>'descriptionText' ELSE description_text END,
 state_id=coalesce((p->>'stateId')::uuid,state_id),lane_id=CASE WHEN p?'laneId' THEN (p->>'laneId')::uuid ELSE lane_id END,responsible_id=new_responsible,
 priority=coalesce(p->>'priority',priority),start_date=CASE WHEN p?'startDate' THEN (p->>'startDate')::date ELSE start_date END,due_date=CASE WHEN p?'dueDate' THEN (p->>'dueDate')::date ELSE due_date END,
 milestone_id=CASE WHEN p?'milestoneId' THEN (p->>'milestoneId')::uuid ELSE milestone_id END,type_id=coalesce((p->>'typeId')::uuid,type_id),parent_id=CASE WHEN p?'parentId' THEN (p->>'parentId')::uuid ELSE parent_id END,
 sort_key=coalesce(p->>'sortKey',sort_key),deleted_at=CASE WHEN p->>'delete'='true' THEN now() ELSE deleted_at END,version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;RETURN t;END$$;
CREATE FUNCTION move_task(tid uuid,expected integer,p jsonb) RETURNS task LANGUAGE sql AS $$ SELECT mutate_task(tid,expected,p) $$;
CREATE FUNCTION set_task_parent(tid uuid,pid uuid,expected integer,p jsonb DEFAULT '{}') RETURNS task LANGUAGE sql AS $$ SELECT mutate_task(tid,expected,p||jsonb_build_object('parentId',pid)) $$;
CREATE FUNCTION set_task_responsible(tid uuid,uid uuid,expected integer) RETURNS task LANGUAGE sql AS $$ SELECT mutate_task(tid,expected,jsonb_build_object('responsibleUserId',uid)) $$;
CREATE FUNCTION add_task_participant(tid uuid,uid uuid,expected integer) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;BEGIN
 t:=require_task_edit(tid,expected);IF uid=t.responsible_id OR NOT is_worker_eligible(uid,t.board_id) THEN PERFORM raise_app_error('PARTICIPANT_NOT_ALLOWED');END IF;
 INSERT INTO task_participant(task_id,workspace_id,board_id,user_id,added_by) VALUES(tid,t.workspace_id,t.board_id,uid,actor_id()) ON CONFLICT DO NOTHING;
 IF FOUND THEN UPDATE task SET version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action,new_value) VALUES(t.workspace_id,t.board_id,tid,actor_id(),'participant.add',to_jsonb(uid));END IF;RETURN t;END$$;
CREATE FUNCTION remove_task_participant(tid uuid,uid uuid,expected integer) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;BEGIN t:=require_task_edit(tid,expected);DELETE FROM task_participant WHERE task_id=tid AND user_id=uid;IF FOUND THEN UPDATE task SET version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action,old_value) VALUES(t.workspace_id,t.board_id,tid,actor_id(),'participant.remove',to_jsonb(uid));END IF;RETURN t;END$$;
CREATE FUNCTION set_task_label(tid uuid,lid uuid,expected integer,p_add boolean) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;BEGIN t:=require_task_edit(tid,expected);IF p_add THEN INSERT INTO task_label VALUES(tid,t.board_id,lid) ON CONFLICT DO NOTHING;ELSE DELETE FROM task_label WHERE task_id=tid AND label_id=lid;END IF;IF FOUND THEN UPDATE task SET version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;END IF;RETURN t;END$$;
CREATE FUNCTION reorder_task(tid uuid,p_key text) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;BEGIN SELECT * INTO t FROM task WHERE id=tid;t:=require_task_edit(tid,t.version);UPDATE task SET sort_key=p_key WHERE id=tid RETURNING * INTO t;RETURN t;END$$;

CREATE FUNCTION focus_ids(tid uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$SELECT ARRAY[]::uuid[]$$;
CREATE FUNCTION task_plugin_fields(tid uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION require_board_manage(bid uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT can_manage_board(actor_id(),bid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;END$$;
CREATE FUNCTION require_task_read(tid uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT can_read_task(actor_id(),tid) THEN PERFORM raise_app_error('NOT_FOUND');END IF;END$$;

CREATE FUNCTION guard_membership_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF EXISTS(SELECT 1 FROM board_member bm JOIN board b ON b.id=bm.board_id WHERE b.workspace_id=OLD.workspace_id AND bm.user_id=OLD.user_id) THEN PERFORM raise_app_error('DEPENDENCY_CONFLICT');END IF;RETURN OLD;END$$;
CREATE TRIGGER membership_dependencies BEFORE DELETE ON workspace_member FOR EACH ROW EXECUTE FUNCTION guard_membership_delete();
