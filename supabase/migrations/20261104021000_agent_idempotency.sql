-- Request identity survives task edits, token expiry and API process restarts.
-- Tokens never appear here; the digest covers the target board and normalized body.
CREATE TABLE agent_task_creation (
  user_id uuid NOT NULL REFERENCES app_user(id),
  client_mutation_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  board_id uuid NOT NULL REFERENCES board(id),
  task_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,client_mutation_id),
  FOREIGN KEY(task_id,board_id,workspace_id) REFERENCES task(id,board_id,workspace_id)
);

REVOKE ALL ON agent_task_creation FROM PUBLIC;
DO $$DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON agent_task_creation FROM %I',r);
  END IF;
END LOOP;END$$;
