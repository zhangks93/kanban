import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from '../apps/api/src/lib/db';
import { getDatabaseUrl } from '../apps/api/src/lib/database-config';
import { migrate } from './migrations';
const mode = process.argv[2];
try {
  if (!['reset', 'migrate', 'seed', 'permissions'].includes(mode))
    throw Error('Usage: pnpm db:migrate | db:permissions | db:reset | db:seed');
  if (mode === 'reset' || mode === 'seed') {
    const url = new URL(getDatabaseUrl());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw Error(
        'Reset/seed only supports local disposable databases; use db:migrate for CloudBase',
      );
  }
  if (mode === 'reset')
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  if (mode === 'reset' || mode === 'migrate') await migrate(pool);
  if (mode === 'permissions') {
    const sql = await readFile(
      fileURLToPath(
        new URL(
          '../supabase/migrations/20261108000000_cloudbase_server_permissions.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    await transaction(null, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('work-platform:migrations'))");
      await db.query(sql);
    });
    console.log('已重新应用业务对象的服务端专用权限。');
  }
  if (mode === 'reset' || mode === 'seed')
    await pool.query(
      await readFile(fileURLToPath(new URL('../supabase/seed.sql', import.meta.url)), 'utf8'),
    );
} finally {
  await pool.end();
}
