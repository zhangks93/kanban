import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export async function migrate(pool: pg.Pool) {
  const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('work-platform:migrations'))");
    await db.query(
      'CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
    );
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM public.schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      try {
        await db.query('BEGIN');
        await db.query(await readFile(`${directory}${name}`, 'utf8'));
        await db.query('INSERT INTO public.schema_migrations(name) VALUES($1)', [name]);
        await db.query('COMMIT');
        console.log('Applied', name);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock(hashtext('work-platform:migrations'))");
    } finally {
      db.release();
    }
  }
}
