import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../apps/api/src/lib/db';
const mode = process.argv[2];
if (mode === 'reset') {
  const url = new URL(
    process.env.SUPABASE_DB_URL ?? 'postgres://postgres:localdev@localhost:54322/work_platform',
  );
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw Error('Reset only supports local development databases');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
}
if (mode === 'reset' || mode === 'migrate') {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if ((await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
      continue;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(await readFile(`supabase/migrations/${name}`, 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await db.query('COMMIT');
      console.log('Applied', name);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
}
if (mode === 'reset' || mode === 'seed')
  await pool.query(await readFile('supabase/seed.sql', 'utf8'));
await pool.end();
