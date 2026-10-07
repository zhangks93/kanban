-- Optional planning-poker estimates, expressed in working days (not story points).
ALTER TABLE task ADD COLUMN estimate_days integer
 CHECK (estimate_days IN (1,2,3,5,8,13,21,34,55,89));

CREATE TABLE task_work_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL, board_id uuid NOT NULL, workspace_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES app_user,
 work_date date NOT NULL,
 hours integer NOT NULL CHECK (hours BETWEEN 1 AND 24),
 note text NOT NULL CHECK (char_length(trim(note)) BETWEEN 1 AND 2000),
 client_mutation_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id),
 UNIQUE (user_id,client_mutation_id)
);
CREATE INDEX work_log_task_date ON task_work_log(task_id,work_date DESC,id);
CREATE INDEX work_log_workspace_date ON task_work_log(workspace_id,work_date,user_id);
CREATE INDEX work_log_user_date ON task_work_log(user_id,work_date);

-- Serialize each user's entries, including edits that move an entry to another day.
CREATE FUNCTION lock_work_log_user(uid uuid) RETURNS void LANGUAGE sql AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('work-log-user:'||uid::text,0))
$$;
CREATE FUNCTION guard_work_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_log task_work_log; daily_hours integer;
BEGIN
 row_log:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 PERFORM lock_task_scope(row_log.task_id);
 PERFORM require_task_read(row_log.task_id);
 IF NOT can_edit_task(actor_id(),row_log.task_id) OR row_log.user_id IS DISTINCT FROM actor_id() THEN
  PERFORM raise_app_error('FORBIDDEN');
 END IF;
 PERFORM lock_work_log_user(row_log.user_id);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.task_id,NEW.board_id,NEW.workspace_id,NEW.user_id,NEW.client_mutation_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.task_id,OLD.board_id,OLD.workspace_id,OLD.user_id,OLD.client_mutation_id,OLD.created_at) THEN
  PERFORM raise_app_error('VALIDATION_FAILED');
 END IF;
 IF NEW.work_date>(now() AT TIME ZONE 'Asia/Shanghai')::date THEN PERFORM raise_app_error('VALIDATION_FAILED'); END IF;
 SELECT coalesce(sum(hours),0) INTO daily_hours FROM task_work_log
  WHERE user_id=NEW.user_id AND work_date=NEW.work_date AND id<>NEW.id;
 IF daily_hours+NEW.hours>24 THEN PERFORM raise_app_error('WORK_LOG_DAILY_LIMIT'); END IF;
 NEW.note:=trim(NEW.note);
 NEW.version:=CASE WHEN TG_OP='UPDATE' THEN OLD.version+1 ELSE 1 END;
 NEW.updated_at:=now();
 RETURN NEW;
END$$;
CREATE TRIGGER guard_work_log_write BEFORE INSERT OR UPDATE OR DELETE ON task_work_log
 FOR EACH ROW EXECUTE FUNCTION guard_work_log();

CREATE FUNCTION work_log_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_log task_work_log;
BEGIN
 row_log:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 UPDATE task SET last_activity_at=now() WHERE id=row_log.task_id;
 INSERT INTO task_activity(workspace_id,board_id,task_id,actor_id,action,old_value,new_value)
 VALUES(row_log.workspace_id,row_log.board_id,row_log.task_id,actor_id(),
  'work-log.'||CASE TG_OP WHEN 'INSERT' THEN 'add' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
  CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
  CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
 RETURN NULL;
END$$;
CREATE TRIGGER work_log_activity_write AFTER INSERT OR UPDATE OR DELETE ON task_work_log
 FOR EACH ROW EXECUTE FUNCTION work_log_activity();

CREATE FUNCTION create_work_log(tid uuid,p jsonb) RETURNS task_work_log LANGUAGE plpgsql AS $$
DECLARE t task; entry task_work_log;
BEGIN
 PERFORM lock_task_scope(tid); PERFORM require_task_read(tid);
 IF NOT can_edit_task(actor_id(),tid) THEN PERFORM raise_app_error('FORBIDDEN'); END IF;
 PERFORM lock_work_log_user(actor_id());
 SELECT * INTO entry FROM task_work_log WHERE user_id=actor_id() AND client_mutation_id=(p->>'clientMutationId')::uuid;
 IF entry.id IS NOT NULL THEN
  IF entry.task_id<>tid THEN PERFORM raise_app_error('VALIDATION_FAILED'); END IF;
  RETURN entry;
 END IF;
 SELECT * INTO t FROM task WHERE id=tid;
 INSERT INTO task_work_log(task_id,board_id,workspace_id,user_id,work_date,hours,note,client_mutation_id)
 VALUES(tid,t.board_id,t.workspace_id,actor_id(),(p->>'workDate')::date,(p->>'hours')::integer,p->>'note',(p->>'clientMutationId')::uuid)
 RETURNING * INTO entry;
 RETURN entry;
END$$;

CREATE FUNCTION mutate_work_log(tid uuid,lid uuid,expected integer,p jsonb,p_delete boolean DEFAULT false)
 RETURNS task_work_log LANGUAGE plpgsql AS $$
DECLARE entry task_work_log;
BEGIN
 PERFORM lock_task_scope(tid); PERFORM require_task_read(tid);
 PERFORM lock_work_log_user(actor_id());
 SELECT * INTO entry FROM task_work_log WHERE id=lid AND task_id=tid FOR UPDATE;
 IF entry.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND'); END IF;
 IF entry.user_id<>actor_id() OR NOT can_edit_task(actor_id(),tid) THEN PERFORM raise_app_error('FORBIDDEN'); END IF;
 IF entry.version<>expected THEN PERFORM raise_app_error('VERSION_CONFLICT'); END IF;
 IF p_delete THEN DELETE FROM task_work_log WHERE id=lid;
 ELSE UPDATE task_work_log SET work_date=(p->>'workDate')::date,hours=(p->>'hours')::integer,note=p->>'note'
  WHERE id=lid RETURNING * INTO entry;
 END IF;
 RETURN entry;
END$$;

CREATE OR REPLACE FUNCTION guard_task() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE grp text;BEGIN
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
  IF ROW(NEW.title,NEW.description,NEW.state_id,NEW.responsible_id,NEW.priority,NEW.start_date,NEW.due_date,NEW.milestone_id,NEW.type_id,NEW.parent_id,NEW.lane_id,NEW.deleted_at,NEW.estimate_days) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.state_id,OLD.responsible_id,OLD.priority,OLD.start_date,OLD.due_date,OLD.milestone_id,OLD.type_id,OLD.parent_id,OLD.lane_id,OLD.deleted_at,OLD.estimate_days) THEN NEW.version:=OLD.version+1;NEW.last_activity_at:=now();END IF;
 END IF;
 IF NEW.lane_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.lane_id IS DISTINCT FROM OLD.lane_id) AND NOT EXISTS(SELECT 1 FROM board b JOIN board_lane l ON l.board_id=b.id WHERE b.id=NEW.board_id AND b.lane_mode='manual' AND l.id=NEW.lane_id AND l.status='active') THEN PERFORM raise_app_error('LANE_NOT_ALLOWED');END IF;
 IF NEW.state_group='started' THEN NEW.started_at:=coalesce(NEW.started_at,now());END IF;
 IF NEW.state_group='completed' THEN NEW.completed_at:=coalesce(NEW.completed_at,now());END IF;
 IF NEW.state_group='cancelled' THEN NEW.cancelled_at:=coalesce(NEW.cancelled_at,now());END IF;
 NEW.updated_at:=now();RETURN NEW;END$$;

CREATE OR REPLACE FUNCTION create_task(bid uuid,p jsonb) RETURNS task LANGUAGE plpgsql AS $$DECLARE b board;t task;sid uuid;typ uuid;uid uuid;BEGIN
 SELECT * INTO b FROM board WHERE id=bid;IF b.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;
 PERFORM lock_workspace(b.workspace_id);PERFORM lock_board(bid);IF p->>'clientMutationId' IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('task-client:'||actor_id()::text||':'||(p->>'clientMutationId'),0));END IF;PERFORM pg_advisory_xact_lock(hashtextextended('task-tree:'||bid::text,0));
 IF NOT can_edit_board(actor_id(),bid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 IF p->>'clientMutationId' IS NOT NULL THEN SELECT * INTO t FROM task WHERE reporter_id=actor_id() AND client_mutation_id=(p->>'clientMutationId')::uuid;IF t.id IS NOT NULL THEN RETURN t;END IF;END IF;
 IF NOT is_worker_eligible((p->>'responsibleUserId')::uuid,bid) THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
 sid:=coalesce((p->>'stateId')::uuid,(SELECT id FROM board_state WHERE board_id=bid AND is_initial));typ:=coalesce((p->>'typeId')::uuid,(SELECT id FROM board_task_type WHERE board_id=bid ORDER BY sort_order LIMIT 1));
 UPDATE board SET task_seq=task_seq+1 WHERE id=bid RETURNING task_seq INTO b.task_seq;
 INSERT INTO task(workspace_id,board_id,lane_id,seq,title,description,description_text,type_id,responsible_id,requester_id,reporter_id,state_id,state_group,priority,start_date,due_date,milestone_id,parent_id,sort_key,client_mutation_id,estimate_days)
 VALUES(b.workspace_id,bid,(p->>'laneId')::uuid,b.task_seq,p->>'title',p->'description',p->>'descriptionText',typ,(p->>'responsibleUserId')::uuid,(p->>'requesterId')::uuid,actor_id(),sid,(SELECT state_group FROM board_state WHERE id=sid),coalesce(p->>'priority','none'),(p->>'startDate')::date,(p->>'dueDate')::date,(p->>'milestoneId')::uuid,(p->>'parentId')::uuid,coalesce(p->>'sortKey',initial_sort_key(b.task_seq)),(p->>'clientMutationId')::uuid,(p->>'estimateDays')::integer) RETURNING * INTO t;
 FOR uid IN SELECT jsonb_array_elements_text(coalesce(p->'participantUserIds','[]'))::uuid LOOP INSERT INTO task_participant(task_id,workspace_id,board_id,user_id,added_by) VALUES(t.id,b.workspace_id,bid,uid,actor_id());END LOOP;RETURN t;END$$;

CREATE OR REPLACE FUNCTION mutate_task(tid uuid,expected integer,p jsonb) RETURNS task LANGUAGE plpgsql AS $$DECLARE t task;new_responsible uuid;BEGIN
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
 estimate_days=CASE WHEN p?'estimateDays' THEN (p->>'estimateDays')::integer ELSE estimate_days END,
 sort_key=coalesce(p->>'sortKey',sort_key),deleted_at=CASE WHEN p->>'delete'='true' THEN now() ELSE deleted_at END,version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;RETURN t;END$$;

-- Match the server-only access policy of the previous migrations.
REVOKE ALL ON TABLE task_work_log FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_work_log_user(uuid),guard_work_log(),work_log_activity(),create_work_log(uuid,jsonb),mutate_work_log(uuid,uuid,integer,jsonb,boolean) FROM PUBLIC;
DO $$DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  EXECUTE format('REVOKE ALL ON TABLE task_work_log FROM %I',r);
  EXECUTE format('REVOKE ALL ON FUNCTION lock_work_log_user(uuid),guard_work_log(),work_log_activity(),create_work_log(uuid,jsonb),mutate_work_log(uuid,uuid,integer,jsonb,boolean) FROM %I',r);
 END IF;
END LOOP;END$$;
