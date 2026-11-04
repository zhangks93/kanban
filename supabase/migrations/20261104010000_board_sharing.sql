-- Share credentials are bearer secrets. Only their SHA-256 digests are retained.
CREATE TABLE board_public_share (
  board_id uuid PRIMARY KEY REFERENCES board(id),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_write AFTER INSERT OR UPDATE OR DELETE ON board_public_share
FOR EACH ROW EXECUTE FUNCTION audit_mutation();

ALTER TABLE intake_request ALTER COLUMN requester_id DROP NOT NULL;
ALTER TABLE intake_request ADD COLUMN source text NOT NULL DEFAULT 'member' CHECK(source IN('member','public'));
ALTER TABLE intake_request ADD COLUMN guest_name text;
ALTER TABLE intake_request ADD COLUMN guest_contact text;
ALTER TABLE intake_request ADD COLUMN public_ip_hash text;
ALTER TABLE intake_request ADD CONSTRAINT intake_request_submitter CHECK (
  (source='member' AND requester_id IS NOT NULL AND guest_name IS NULL AND guest_contact IS NULL AND public_ip_hash IS NULL)
  OR (source='public' AND requester_id IS NULL AND guest_name IS NOT NULL AND public_ip_hash IS NOT NULL AND char_length(trim(guest_name)) BETWEEN 1 AND 100
      AND coalesce(char_length(guest_contact),0)<=200 AND public_ip_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX intake_public_mutation ON intake_request(board_id,client_mutation_id) WHERE source='public';
CREATE INDEX intake_public_rate ON intake_request(board_id,public_ip_hash,created_at) WHERE source='public';

-- A manager triages public requests through the same intake flow. Guest identity stays
-- on intake_request and is never added to the task description or public summaries.
CREATE OR REPLACE FUNCTION decide_intake(rid uuid,p_accept boolean,p jsonb) RETURNS intake_request LANGUAGE plpgsql AS $$
DECLARE r intake_request;t task;wid uuid;bid uuid;typ uuid;
BEGIN
  SELECT workspace_id,board_id INTO wid,bid FROM intake_request WHERE id=rid;
  IF bid IS NULL THEN PERFORM raise_app_error('NOT_FOUND');END IF;
  PERFORM lock_workspace(wid);PERFORM lock_board(bid,true);PERFORM require_board_manage(bid);
  SELECT * INTO r FROM intake_request WHERE id=rid FOR UPDATE;
  IF r.status<>'pending' THEN RETURN r;END IF;
  IF p_accept THEN
    IF r.source='public' THEN
      SELECT bt.id INTO typ FROM board_task_type bt JOIN board b ON b.id=bt.board_id
      WHERE bt.board_id=bid AND NOT bt.is_container
      ORDER BY CASE WHEN (b.plugin_key='rnd' AND bt.key='story') OR (b.plugin_key='ops' AND bt.key='incident') THEN 0 ELSE 1 END,bt.sort_order LIMIT 1;
      p:=p||jsonb_build_object('typeId',typ);
    END IF;
    t:=create_task(bid,p||jsonb_build_object('title',r.title,'descriptionText',r.description,'requesterId',r.requester_id,'dueDate',r.expected_date,'clientMutationId',r.client_mutation_id));
    UPDATE intake_request SET status='accepted',task_id=t.id,updated_at=now() WHERE id=rid RETURNING * INTO r;
  ELSE
    UPDATE intake_request SET status='declined',reason=p->>'reason',updated_at=now() WHERE id=rid RETURNING * INTO r;
  END IF;
  RETURN r;
END$$;
REVOKE ALL ON board_public_share FROM PUBLIC;
REVOKE ALL ON FUNCTION decide_intake(uuid,boolean,jsonb) FROM PUBLIC;
DO $$DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON board_public_share FROM %I',r);
    EXECUTE format('REVOKE ALL ON FUNCTION decide_intake(uuid,boolean,jsonb) FROM %I',r);
  END IF;
END LOOP;END$$;
