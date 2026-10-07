BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; SELECT plan(2); SELECT has_extension('pg_trgm'); SELECT ok(gen_random_uuid() IS NOT NULL,'UUID available'); SELECT * FROM finish(); ROLLBACK;
