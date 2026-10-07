
CREATE TABLE app_user (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feishu_user_id text,feishu_open_id text UNIQUE,feishu_union_id text,
 display_name text NOT NULL,avatar_url text,email text,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','deactivated')),
 is_platform_admin boolean NOT NULL DEFAULT false,wip_limit smallint NOT NULL DEFAULT 3 CHECK(wip_limit BETWEEN 1 AND 10),last_login_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE NOT NULL,name text NOT NULL,description text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_member (
 workspace_id uuid REFERENCES workspace,user_id uuid REFERENCES app_user,role text NOT NULL CHECK(role IN('owner','admin','member')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),joined_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE auth_session(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES app_user,expires_at timestamptz NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE oauth_nonce(state_hash text PRIMARY KEY,next_path text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid REFERENCES workspace,actor_id uuid REFERENCES app_user,action text NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,before jsonb,after jsonb,request_id text,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.actor_id',true),'')::uuid $$;
CREATE FUNCTION raise_app_error(code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%',code USING ERRCODE='P0001'; END $$;
CREATE FUNCTION lock_account(uid uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtextextended('account-status:'||uid::text,0)) $$;
CREATE FUNCTION lock_owner(wid uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtextextended('workspace-owner:'||wid::text,0)) $$;
CREATE FUNCTION lock_workspace(wid uuid,exclusive boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF exclusive THEN PERFORM pg_advisory_xact_lock(hashtextextended('scope:workspace:'||wid::text,0)); ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('scope:workspace:'||wid::text,0)); END IF; END $$;
CREATE FUNCTION lock_wip(uid uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtextextended('wip:'||uid::text,0)) $$;
CREATE FUNCTION active_admin(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM app_user WHERE id=uid AND status='active' AND is_platform_admin)$$;
CREATE FUNCTION workspace_role(uid uuid,wid uuid) RETURNS text LANGUAGE sql STABLE AS $$SELECT m.role FROM workspace_member m JOIN app_user u ON u.id=m.user_id JOIN workspace w ON w.id=m.workspace_id WHERE m.user_id=uid AND m.workspace_id=wid AND m.status='active' AND u.status='active' AND w.status='active'$$;
CREATE FUNCTION can_manage_workspace(uid uuid,wid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(workspace_role(uid,wid) IN('owner','admin'),false) $$;
CREATE FUNCTION effective_owner_count(wid uuid) RETURNS bigint LANGUAGE sql STABLE AS $$SELECT count(*) FROM workspace_member m JOIN app_user u ON u.id=m.user_id WHERE m.workspace_id=wid AND m.role='owner' AND m.status='active' AND u.status='active'$$;
CREATE FUNCTION check_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE wid uuid;BEGIN
 IF TG_TABLE_NAME='workspace' THEN wid:=COALESCE(NEW.id,OLD.id);ELSE wid:=COALESCE(NEW.workspace_id,OLD.workspace_id);END IF;
 IF EXISTS(SELECT 1 FROM workspace WHERE id=wid) AND effective_owner_count(wid)=0 THEN PERFORM raise_app_error('LAST_WORKSPACE_OWNER');END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER workspace_owner_insert AFTER INSERT OR UPDATE ON workspace DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_owner();
CREATE CONSTRAINT TRIGGER workspace_owner_member AFTER INSERT OR UPDATE OR DELETE ON workspace_member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_owner();
CREATE FUNCTION guard_member() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE wid uuid;uid uuid;BEGIN
 wid:=COALESCE(NEW.workspace_id,OLD.workspace_id);uid:=COALESCE(NEW.user_id,OLD.user_id);IF TG_OP='UPDATE' AND (NEW.workspace_id<>OLD.workspace_id OR NEW.user_id<>OLD.user_id) THEN PERFORM raise_app_error('VALIDATION_FAILED');END IF;
 IF TG_OP<>'DELETE' AND NEW.role='owner' THEN PERFORM lock_account(uid);END IF;
 PERFORM lock_owner(wid);PERFORM lock_workspace(wid,true);
 IF TG_OP<>'DELETE' AND NEW.role='owner' AND NEW.status='active' AND NOT EXISTS(SELECT 1 FROM app_user WHERE id=uid AND status='active') THEN PERFORM raise_app_error('RESPONSIBLE_NOT_ALLOWED');END IF;
 RETURN COALESCE(NEW,OLD);END $$;
CREATE TRIGGER guard_workspace_member BEFORE INSERT OR UPDATE OR DELETE ON workspace_member FOR EACH ROW EXECUTE FUNCTION guard_member();
CREATE FUNCTION guard_user_status() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE wid uuid;BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  PERFORM lock_account(NEW.id);
  FOR wid IN SELECT workspace_id FROM workspace_member WHERE user_id=NEW.id AND status='active' ORDER BY workspace_id LOOP PERFORM lock_owner(wid);END LOOP;
  FOR wid IN SELECT workspace_id FROM workspace_member WHERE user_id=NEW.id AND status='active' ORDER BY workspace_id LOOP PERFORM lock_workspace(wid,true);END LOOP;
  PERFORM lock_wip(NEW.id);
  IF NEW.status='deactivated' THEN
   IF EXISTS(SELECT 1 FROM workspace_member m WHERE m.user_id=NEW.id AND m.status='active' AND m.role='owner' AND effective_owner_count(m.workspace_id)<=1) THEN PERFORM raise_app_error('LAST_WORKSPACE_OWNER'); END IF;
  END IF;
 END IF;NEW.updated_at:=now();RETURN NEW;END $$;
CREATE TRIGGER guard_account_status BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION guard_user_status();
CREATE FUNCTION user_owner_final() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE wid uuid;BEGIN
 FOR wid IN SELECT workspace_id FROM workspace_member WHERE user_id=NEW.id AND role='owner' LOOP IF effective_owner_count(wid)=0 THEN PERFORM raise_app_error('LAST_WORKSPACE_OWNER');END IF;END LOOP;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER user_owner_check AFTER UPDATE ON app_user DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION user_owner_final();
CREATE FUNCTION create_workspace(p_key text,p_name text,p_description text DEFAULT NULL) RETURNS workspace LANGUAGE plpgsql AS $$DECLARE result workspace;BEGIN
 IF NOT active_admin(actor_id()) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 INSERT INTO workspace(key,name,description,created_by) VALUES(p_key,p_name,p_description,actor_id()) RETURNING * INTO result;
 PERFORM lock_account(actor_id());PERFORM lock_owner(result.id);PERFORM lock_workspace(result.id,true);
 INSERT INTO workspace_member VALUES(result.id,actor_id(),'owner','active',now(),now(),now());
 INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,after) VALUES(result.id,actor_id(),'workspace.create','workspace',result.id,to_jsonb(result));RETURN result;END $$;
CREATE FUNCTION set_workspace_member(wid uuid,uid uuid,p_role text,p_status text DEFAULT 'active') RETURNS workspace_member LANGUAGE plpgsql AS $$DECLARE result workspace_member;BEGIN
 IF p_role='owner' THEN PERFORM lock_account(uid);END IF;PERFORM lock_owner(wid);PERFORM lock_workspace(wid,true);
 IF NOT can_manage_workspace(actor_id(),wid) THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 IF (p_role='owner' OR EXISTS(SELECT 1 FROM workspace_member WHERE workspace_id=wid AND user_id=uid AND role='owner')) AND workspace_role(actor_id(),wid)<>'owner' THEN PERFORM raise_app_error('FORBIDDEN');END IF;
 INSERT INTO workspace_member(workspace_id,user_id,role,status) VALUES(wid,uid,p_role,p_status) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=now() RETURNING * INTO result;
 IF effective_owner_count(wid)=0 THEN PERFORM raise_app_error('LAST_WORKSPACE_OWNER');END IF;
 INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,after) VALUES(wid,actor_id(),'workspace.member','user',uid,to_jsonb(result));RETURN result;END $$;
CREATE FUNCTION set_user_status(uid uuid,p_status text) RETURNS app_user LANGUAGE plpgsql AS $$DECLARE result app_user;wid uuid;BEGIN
 IF NOT active_admin(actor_id()) THEN PERFORM raise_app_error('FORBIDDEN');END IF;PERFORM lock_account(uid);
 FOR wid IN SELECT workspace_id FROM workspace_member WHERE user_id=uid AND status='active' ORDER BY workspace_id LOOP PERFORM lock_owner(wid);END LOOP;
 FOR wid IN SELECT workspace_id FROM workspace_member WHERE user_id=uid AND status='active' ORDER BY workspace_id LOOP PERFORM lock_workspace(wid,true);END LOOP;
 PERFORM lock_wip(uid);PERFORM 1 FROM app_user WHERE id=uid FOR UPDATE;
 UPDATE app_user SET status=p_status WHERE id=uid RETURNING * INTO result;
 IF result.id IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;RETURN result;END $$;
