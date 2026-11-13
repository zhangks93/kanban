import './env';
import { requestContext } from './request-context';
import pg from 'pg';
import { getDatabasePoolConfig } from './database-config';
// CloudBase HTTP mode imports the legacy modules but never opens a TCP pool.
let instance: pg.Pool | undefined;
export const pool = new Proxy({} as pg.Pool, {
  get(_target, property) {
    if (property === 'end' && !instance) return async () => {};
    instance ??= new pg.Pool(getDatabasePoolConfig());
    const value = Reflect.get(instance, property);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
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
    await db.query("SELECT set_config('app.agent_authorization_id',$1,true)", [
      requestContext.getStore()?.agentAuthorizationId ?? '',
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
