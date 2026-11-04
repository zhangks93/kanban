-- Human-delegated Agent access. Browser Feishu sessions stay separate from CLI
-- credentials; neither a plaintext access token nor device secret is retained.
CREATE TABLE agent_authorization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  client_name text NOT NULL CHECK(char_length(trim(client_name)) BETWEEN 1 AND 100),
  scopes text[] NOT NULL CHECK(scopes IN(ARRAY['read']::text[],ARRAY['read','write']::text[])),
  token_hash text UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '12 hours')
);
CREATE INDEX agent_authorization_user ON agent_authorization(user_id,created_at DESC);

CREATE TABLE agent_device_request (
  device_code_hash text PRIMARY KEY CHECK(device_code_hash ~ '^[a-f0-9]{64}$'),
  user_code_hash text NOT NULL UNIQUE CHECK(user_code_hash ~ '^[a-f0-9]{64}$'),
  client_name text NOT NULL CHECK(char_length(trim(client_name)) BETWEEN 1 AND 100),
  scopes text[] NOT NULL CHECK(scopes IN(ARRAY['read']::text[],ARRAY['read','write']::text[])),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','denied','consumed')),
  authorization_id uuid UNIQUE REFERENCES agent_authorization(id),
  decided_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CHECK((status IN('approved','consumed'))=(authorization_id IS NOT NULL))
);
CREATE INDEX agent_device_expiry ON agent_device_request(expires_at);

-- Durable quotas work across API processes. Keys are salted hashes, never IPs,
-- user codes, device secrets or access tokens.
CREATE TABLE agent_auth_rate_limit (
  key_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL
);

ALTER TABLE audit_log ADD COLUMN agent_authorization_id uuid REFERENCES agent_authorization(id);
ALTER TABLE task_activity ADD COLUMN agent_authorization_id uuid REFERENCES agent_authorization(id);
ALTER TABLE task_activity ADD COLUMN request_id text;
CREATE FUNCTION agent_audit_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.agent_authorization_id:=nullif(current_setting('app.agent_authorization_id',true),'')::uuid;
  NEW.request_id:=coalesce(NEW.request_id,nullif(current_setting('app.request_id',true),''));
  RETURN NEW;
END$$;
CREATE TRIGGER agent_context BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION agent_audit_context();
CREATE TRIGGER agent_context BEFORE INSERT ON task_activity FOR EACH ROW EXECUTE FUNCTION agent_audit_context();

-- Requests include reads and rejected writes made with a valid delegation.
-- Use registered route templates; never retain queries, request bodies or tokens.
CREATE TABLE agent_request_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  authorization_id uuid NOT NULL REFERENCES agent_authorization(id),
  actor_id uuid NOT NULL REFERENCES app_user(id),
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  request_id text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  status_code integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_request_authorization ON agent_request_log(authorization_id,occurred_at DESC);

-- A grant's lifecycle is audited without ever snapshotting token hashes.
CREATE FUNCTION audit_agent_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
  IF TG_OP='INSERT' THEN action_name:='agent.authorize';
  ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN action_name:='agent.revoke';
  ELSE RETURN NULL;
  END IF;
  INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,after)
  VALUES(NEW.workspace_id,coalesce(actor_id(),NEW.user_id),action_name,'agent_authorization',NEW.id,
    jsonb_build_object('clientName',NEW.client_name,'scopes',NEW.scopes,'userId',NEW.user_id,'expiresAt',NEW.expires_at,'revokedAt',NEW.revoked_at));
  RETURN NULL;
END$$;
CREATE TRIGGER audit_write AFTER INSERT OR UPDATE ON agent_authorization
FOR EACH ROW EXECUTE FUNCTION audit_agent_authorization();

REVOKE ALL ON agent_authorization,agent_device_request,agent_auth_rate_limit,agent_request_log FROM PUBLIC;
REVOKE ALL ON FUNCTION agent_audit_context(),audit_agent_authorization() FROM PUBLIC;
DO $$DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON agent_authorization,agent_device_request,agent_auth_rate_limit,agent_request_log FROM %I',r);
    EXECUTE format('REVOKE ALL ON FUNCTION agent_audit_context(),audit_agent_authorization() FROM %I',r);
  END IF;
END LOOP;END$$;
