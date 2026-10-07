import './env';
import { requestContext } from './request-context';
import pg from 'pg';
if (!process.env.SUPABASE_DB_URL)
  throw Error('请在项目根目录 .env 中配置 SUPABASE_DB_URL（运行 pnpm setup 初始化配置）');
export const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  options: '-c search_path=public,extensions',
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
