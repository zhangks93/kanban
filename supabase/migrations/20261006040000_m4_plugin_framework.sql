
CREATE TABLE workspace_plugin(workspace_id uuid REFERENCES workspace,plugin_key text NOT NULL,config jsonb NOT NULL DEFAULT '{}',enabled_by uuid NOT NULL REFERENCES app_user,enabled_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,plugin_key));
CREATE FUNCTION require_plugin_enabled(wid uuid,p_key text) RETURNS void LANGUAGE plpgsql AS $$BEGIN PERFORM lock_workspace(wid);IF NOT EXISTS(SELECT 1 FROM workspace_plugin WHERE workspace_id=wid AND plugin_key=p_key) THEN PERFORM raise_app_error('PLUGIN_NOT_ENABLED');END IF;END$$;
CREATE FUNCTION set_workspace_plugin(wid uuid,p_key text,p_enabled boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM lock_workspace(wid,true);IF NOT can_manage_workspace(actor_id(),wid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 IF p_enabled THEN INSERT INTO workspace_plugin(workspace_id,plugin_key,enabled_by) VALUES(wid,p_key,actor_id()) ON CONFLICT DO NOTHING;
 ELSE IF EXISTS(SELECT 1 FROM board WHERE workspace_id=wid AND plugin_key=p_key AND status='active') THEN PERFORM raise_app_error('PLUGIN_HAS_DEPENDENCIES');END IF;DELETE FROM workspace_plugin WHERE workspace_id=wid AND plugin_key=p_key;END IF;
END$$;
CREATE FUNCTION guard_plugin_dependency() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 PERFORM lock_workspace(OLD.workspace_id,true);
 IF EXISTS(SELECT 1 FROM board WHERE workspace_id=OLD.workspace_id AND plugin_key=OLD.plugin_key AND status='active') THEN PERFORM raise_app_error('PLUGIN_HAS_DEPENDENCIES');END IF;RETURN OLD;END$$;
CREATE TRIGGER plugin_dependency BEFORE DELETE ON workspace_plugin FOR EACH ROW EXECUTE FUNCTION guard_plugin_dependency();
CREATE FUNCTION guard_board_plugin() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.plugin_key IS NOT NULL AND NEW.status='active' THEN PERFORM require_plugin_enabled(NEW.workspace_id,NEW.plugin_key);END IF;RETURN NEW;END$$;
CREATE TRIGGER board_plugin_enabled BEFORE INSERT OR UPDATE ON board FOR EACH ROW EXECUTE FUNCTION guard_board_plugin();
