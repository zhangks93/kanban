import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestContext } from './request-context';
import pg from 'pg';
import { config } from 'dotenv';
config({
  quiet: true,
  path:
    process.env.ENV_FILE ??
    [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(existsSync),
});
export const pool = new pg.Pool({
  connectionString:
    process.env.SUPABASE_DB_URL ?? 'postgres://postgres:localdev@localhost:54322/work_platform',
  max: 20,
  connectionTimeoutMillis: 5000,
});
export async function transaction<T>(
  actor: string | null,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.actor_id',$1,true)", [actor ?? '']);
    await db.query("SELECT set_config('app.request_id',$1,true)", [
      requestContext.getStore()?.requestId ?? '',
    ]);
    const value = await fn(db);
    await db.query('COMMIT');
    return value;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
