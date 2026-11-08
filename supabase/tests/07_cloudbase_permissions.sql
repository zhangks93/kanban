BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- The private SQL API role retains its existing access after gateway revocation.
SELECT ok(has_table_privilege(current_user, 'public.app_user', 'SELECT,INSERT,UPDATE,DELETE'),
  'private SQL role retains application table access');
SELECT ok(has_function_privilege(current_user, 'public.create_task(uuid,jsonb)', 'EXECUTE'),
  'private SQL role can call transactional business functions');

SELECT is((
  SELECT count(*) FROM pg_class relation,
    LATERAL aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) permission
  WHERE relation.oid IN ('public.app_user'::regclass, 'public.auth_session'::regclass,
    'public.oauth_nonce'::regclass, 'public.agent_authorization'::regclass,
    'public.agent_device_request'::regclass, 'public.schema_migrations'::regclass)
    AND permission.grantee = 0
), 0::bigint, 'PUBLIC cannot read identity, credential or migration tables');

SELECT is((
  SELECT count(*) FROM pg_roles role
  WHERE role.rolname IN ('anon', 'authenticated', 'service_role') AND (
    has_table_privilege(role.oid, 'public.app_user', 'SELECT,INSERT,UPDATE,DELETE') OR
    has_table_privilege(role.oid, 'public.auth_session', 'SELECT,INSERT,UPDATE,DELETE') OR
    has_table_privilege(role.oid, 'public.agent_authorization', 'SELECT,INSERT,UPDATE,DELETE') OR
    has_table_privilege(role.oid, 'public.schema_migrations', 'SELECT,INSERT,UPDATE,DELETE')
  )
), 0::bigint, 'existing CloudBase gateway roles cannot access private application data');

-- Explicit SELECT(column)/UPDATE(column) survives a table-level REVOKE.
-- These checks also catch a regression when the fixture grants only column ACLs.
SELECT is((
  SELECT count(*) FROM pg_attribute attribute,
    LATERAL aclexplode(attribute.attacl) permission
  WHERE attribute.attrelid IN ('public.app_user'::regclass, 'public.auth_session'::regclass,
    'public.oauth_nonce'::regclass, 'public.agent_authorization'::regclass,
    'public.agent_device_request'::regclass, 'public.schema_migrations'::regclass)
    AND attribute.attnum > 0 AND NOT attribute.attisdropped AND permission.grantee = 0
), 0::bigint, 'PUBLIC has no explicit credential or identity column grants');

SELECT is((
  SELECT count(*) FROM pg_roles role
  WHERE role.rolname IN ('anon', 'authenticated', 'service_role') AND (
    has_any_column_privilege(role.oid, 'public.app_user', 'SELECT,INSERT,UPDATE,REFERENCES') OR
    has_any_column_privilege(role.oid, 'public.auth_session', 'SELECT,INSERT,UPDATE,REFERENCES') OR
    has_any_column_privilege(role.oid, 'public.agent_authorization', 'SELECT,INSERT,UPDATE,REFERENCES') OR
    has_any_column_privilege(role.oid, 'public.schema_migrations', 'SELECT,INSERT,UPDATE,REFERENCES')
  )
), 0::bigint, 'gateway roles cannot read or modify individual sensitive columns');

SELECT is((
  SELECT count(*) FROM pg_roles role
  WHERE role.rolname IN ('anon', 'authenticated', 'service_role') AND (
    has_function_privilege(role.oid, 'public.create_task(uuid,jsonb)', 'EXECUTE') OR
    has_function_privilege(role.oid, 'public.create_workspace(text,text,text)', 'EXECUTE') OR
    has_function_privilege(role.oid, 'public.set_user_status(uuid,text)', 'EXECUTE') OR
    has_function_privilege(role.oid, 'public.decide_intake(uuid,boolean,jsonb)', 'EXECUTE')
  )
), 0::bigint, 'gateway roles cannot bypass Feishu API authorization through RPC');

SELECT is((
  SELECT count(*) FROM pg_roles role
  WHERE role.rolname IN ('anon', 'authenticated', 'service_role') AND
    has_sequence_privilege(role.oid, pg_get_serial_sequence('public.audit_log', 'id'), 'USAGE,SELECT,UPDATE')
), 0::bigint, 'gateway roles cannot use application identity sequences');

SELECT * FROM finish();
ROLLBACK;
