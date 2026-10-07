import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../apps/api/src/lib/db';
import { migrate } from './migrations';
const mode = process.argv[2];
try {
  if (!['reset', 'migrate', 'seed'].includes(mode))
    throw Error('Usage: pnpm db:migrate | db:reset | db:seed');
  if (mode === 'reset' || mode === 'seed') {
    const url = new URL(process.env.SUPABASE_DB_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw Error(
        'Reset/seed only supports local disposable databases; use db:migrate for Supabase',
      );
  }
  if (mode === 'reset')
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  if (mode === 'reset' || mode === 'migrate') await migrate(pool);
  if (mode === 'reset' || mode === 'seed')
    await pool.query(
      await readFile(fileURLToPath(new URL('../supabase/seed.sql', import.meta.url)), 'utf8'),
    );
} finally {
  await pool.end();
}
