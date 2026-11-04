-- Shared workspace data replaces per-board system/service catalogs. Legacy rows and
-- identifiers remain available so existing tasks and integrations keep their links.
CREATE TABLE workspace_system (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace,
 name text NOT NULL CHECK(char_length(trim(name)) BETWEEN 1 AND 100),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id),UNIQUE(workspace_id,name)
);
CREATE TABLE workspace_project (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace,
 system_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(trim(name)) BETWEEN 1 AND 100),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id),UNIQUE(id,system_id,workspace_id),UNIQUE(system_id,name),
 FOREIGN KEY(system_id,workspace_id) REFERENCES workspace_system(id,workspace_id)
);

-- Disambiguate same-named legacy objects without dropping or merging their IDs.
-- A generated suffix may itself be another object's original, valid name.
-- Search until an unused candidate is found, keeping every candidate within 100
-- characters (including its complete UUID and retry counter).
CREATE FUNCTION legacy_workspace_system_name(wid uuid,original_name text,sid uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE candidate text:=left(original_name,100);attempt integer:=0;suffix text;BEGIN
 WHILE EXISTS(SELECT 1 FROM workspace_system WHERE workspace_id=wid AND name=candidate AND id<>sid) LOOP
  attempt:=attempt+1;
  suffix:=' · '||sid::text||CASE WHEN attempt=1 THEN '' ELSE ' · '||attempt::text END;
  candidate:=left(original_name,100-char_length(suffix))||suffix;
 END LOOP;
 RETURN candidate;
END$$;
DO $$DECLARE legacy record;BEGIN
 FOR legacy IN
  SELECT * FROM (
   SELECT id,workspace_id,name,version,created_at,updated_at FROM rnd_system
   UNION ALL SELECT id,workspace_id,name,version,created_at,updated_at FROM ops_service
  ) source ORDER BY created_at,id
 LOOP
  INSERT INTO workspace_system(id,workspace_id,name,version,created_at,updated_at)
  VALUES(legacy.id,legacy.workspace_id,legacy_workspace_system_name(legacy.workspace_id,legacy.name,legacy.id),legacy.version,legacy.created_at,legacy.updated_at);
 END LOOP;
END$$;
-- Legacy modules remain modules. Projects start empty and are linked explicitly;
-- neither a module nor a project-coded lane establishes a project's system.

-- Keep legacy creation endpoints and seed imports usable. New interfaces write to
-- workspace_system/workspace_project directly.
CREATE FUNCTION mirror_legacy_foundation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_name text;BEGIN
 LOOP
  target_name:=legacy_workspace_system_name(NEW.workspace_id,NEW.name,NEW.id);
  BEGIN
   INSERT INTO workspace_system(id,workspace_id,name,version,created_at,updated_at)
   VALUES(NEW.id,NEW.workspace_id,target_name,NEW.version,NEW.created_at,NEW.updated_at)
   ON CONFLICT(id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,name=EXCLUDED.name,updated_at=EXCLUDED.updated_at;
   EXIT;
  EXCEPTION WHEN unique_violation THEN
   -- Another catalog or the data manager can claim a candidate after lookup.
   -- The next statement sees the committed row and chooses another name.
  END;
 END LOOP;
 RETURN NEW;
END$$;
CREATE TRIGGER mirror_shared_system AFTER INSERT OR UPDATE ON rnd_system FOR EACH ROW EXECUTE FUNCTION mirror_legacy_foundation();
CREATE TRIGGER mirror_shared_service AFTER INSERT OR UPDATE ON ops_service FOR EACH ROW EXECUTE FUNCTION mirror_legacy_foundation();

-- Replace only the old system scope constraints, retaining legacy module/service
-- references while introducing workspace-scoped fields for both plugins.
DO $$DECLARE constraint_name text;BEGIN
 FOR constraint_name IN
  SELECT conname FROM pg_constraint WHERE conrelid='rnd_task_ext'::regclass AND contype='f'
  AND confrelid='rnd_system'::regclass
 LOOP EXECUTE format('ALTER TABLE rnd_task_ext DROP CONSTRAINT %I',constraint_name);END LOOP;
END$$;
ALTER TABLE rnd_task_ext ADD COLUMN project_id uuid;
ALTER TABLE rnd_task_ext
 ADD FOREIGN KEY(system_id,workspace_id) REFERENCES workspace_system(id,workspace_id),
 ADD FOREIGN KEY(project_id,system_id,workspace_id) REFERENCES workspace_project(id,system_id,workspace_id),
 ADD CHECK(project_id IS NULL OR system_id IS NOT NULL);
ALTER TABLE ops_task_ext ADD COLUMN system_id uuid;
UPDATE ops_task_ext SET system_id=service_id;
ALTER TABLE ops_task_ext ADD FOREIGN KEY(system_id,workspace_id) REFERENCES workspace_system(id,workspace_id);
ALTER TABLE ops_lane_ext ADD COLUMN system_id uuid;
UPDATE ops_lane_ext SET system_id=service_id;
ALTER TABLE ops_lane_ext ADD FOREIGN KEY(system_id,workspace_id) REFERENCES workspace_system(id,workspace_id);
ALTER TABLE rnd_lane_ext ADD COLUMN project_id uuid;
ALTER TABLE rnd_lane_ext ADD FOREIGN KEY(project_id,workspace_id) REFERENCES workspace_project(id,workspace_id);

CREATE FUNCTION normalize_legacy_plugin_data() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.service_id IS NOT NULL AND NEW.system_id IS NULL THEN NEW.system_id:=NEW.service_id;END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER normalize_shared_system BEFORE INSERT OR UPDATE ON ops_task_ext FOR EACH ROW EXECUTE FUNCTION normalize_legacy_plugin_data();
CREATE TRIGGER normalize_shared_lane_system BEFORE INSERT OR UPDATE ON ops_lane_ext FOR EACH ROW EXECUTE FUNCTION normalize_legacy_plugin_data();

CREATE OR REPLACE FUNCTION set_rnd_task_fields(tid uuid,expected integer,p jsonb) RETURNS task LANGUAGE plpgsql AS $$
DECLARE t task;next_system uuid;next_project uuid;next_module uuid;BEGIN
 t:=require_task_edit(tid,expected);PERFORM require_plugin_enabled(t.workspace_id,'rnd');
 IF NOT EXISTS(SELECT 1 FROM board WHERE id=t.board_id AND plugin_key='rnd') THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 INSERT INTO rnd_task_ext(task_id,workspace_id,board_id) VALUES(tid,t.workspace_id,t.board_id) ON CONFLICT DO NOTHING;
 SELECT CASE WHEN p?'system_id' THEN (p->>'system_id')::uuid ELSE system_id END,
  CASE WHEN p?'project_id' THEN (p->>'project_id')::uuid WHEN p?'system_id' THEN NULL ELSE project_id END,
  CASE WHEN p?'module_id' THEN (p->>'module_id')::uuid WHEN p?'project_id' OR p?'system_id' THEN NULL ELSE module_id END
 INTO next_system,next_project,next_module FROM rnd_task_ext WHERE task_id=tid;
 IF (next_system IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_system WHERE id=next_system AND workspace_id=t.workspace_id))
 OR (next_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_project WHERE id=next_project AND system_id=next_system AND workspace_id=t.workspace_id))
 OR (next_module IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rnd_module WHERE id=next_module AND system_id=next_system AND board_id=t.board_id AND workspace_id=t.workspace_id)) THEN
  PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 UPDATE rnd_task_ext SET
  system_id=CASE WHEN p?'system_id' THEN (p->>'system_id')::uuid ELSE system_id END,
  project_id=CASE WHEN p?'project_id' THEN (p->>'project_id')::uuid WHEN p?'system_id' THEN NULL ELSE project_id END,
  module_id=CASE WHEN p?'module_id' THEN (p->>'module_id')::uuid WHEN p?'project_id' OR p?'system_id' THEN NULL ELSE module_id END,
  updated_at=now() WHERE task_id=tid;
 UPDATE task SET version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;RETURN t;
END$$;
CREATE OR REPLACE FUNCTION set_ops_task_fields(tid uuid,expected integer,p jsonb) RETURNS task LANGUAGE plpgsql AS $$
DECLARE t task;next_system uuid;BEGIN
 t:=require_task_edit(tid,expected);PERFORM require_plugin_enabled(t.workspace_id,'ops');
 IF NOT EXISTS(SELECT 1 FROM board WHERE id=t.board_id AND plugin_key='ops') THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 INSERT INTO ops_task_ext(task_id,workspace_id,board_id) VALUES(tid,t.workspace_id,t.board_id) ON CONFLICT DO NOTHING;
 SELECT CASE WHEN p?'system_id' THEN (p->>'system_id')::uuid WHEN p?'service_id' THEN (p->>'service_id')::uuid ELSE system_id END
 INTO next_system FROM ops_task_ext WHERE task_id=tid;
 IF next_system IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_system WHERE id=next_system AND workspace_id=t.workspace_id) THEN
  PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 UPDATE ops_task_ext SET
  severity=CASE WHEN p?'severity' THEN p->>'severity' ELSE severity END,
  impact=CASE WHEN p?'impact' THEN p->>'impact' ELSE impact END,
  detected_at=CASE WHEN p?'detected_at' THEN (p->>'detected_at')::timestamptz ELSE detected_at END,
  recovered_at=CASE WHEN p?'recovered_at' THEN (p->>'recovered_at')::timestamptz ELSE recovered_at END,
  system_id=CASE WHEN p?'system_id' THEN (p->>'system_id')::uuid WHEN p?'service_id' THEN (p->>'service_id')::uuid ELSE system_id END,
  service_id=CASE WHEN p?'service_id' THEN (p->>'service_id')::uuid WHEN p?'system_id' THEN NULL ELSE service_id END,
  updated_at=now() WHERE task_id=tid;
 UPDATE task SET version=version+1,last_activity_at=now() WHERE id=tid RETURNING * INTO t;RETURN t;
END$$;

CREATE TRIGGER audit_write AFTER INSERT OR UPDATE OR DELETE ON workspace_system FOR EACH ROW EXECUTE FUNCTION audit_mutation();
CREATE TRIGGER audit_write AFTER INSERT OR UPDATE OR DELETE ON workspace_project FOR EACH ROW EXECUTE FUNCTION audit_mutation();
REVOKE ALL ON workspace_system,workspace_project FROM PUBLIC;
REVOKE ALL ON FUNCTION legacy_workspace_system_name(uuid,text,uuid),mirror_legacy_foundation(),normalize_legacy_plugin_data(),set_rnd_task_fields(uuid,integer,jsonb),set_ops_task_fields(uuid,integer,jsonb) FROM PUBLIC;
DO $$DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  EXECUTE format('REVOKE ALL ON workspace_system,workspace_project FROM %I',r);
  EXECUTE format('REVOKE ALL ON FUNCTION legacy_workspace_system_name(uuid,text,uuid),mirror_legacy_foundation(),normalize_legacy_plugin_data(),set_rnd_task_fields(uuid,integer,jsonb),set_ops_task_fields(uuid,integer,jsonb) FROM %I',r);
 END IF;
END LOOP;END$$;
