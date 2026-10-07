import { pool, transaction } from '../apps/api/src/lib/db';
import { hash, random, signed } from '../apps/api/src/middleware/auth';
export const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  a: '10000000-0000-4000-8000-000000000002',
  b: '10000000-0000-4000-8000-000000000003',
  c: '10000000-0000-4000-8000-000000000004',
  d: '10000000-0000-4000-8000-000000000005',
  alpha: '20000000-0000-4000-8000-000000000001',
  beta: '20000000-0000-4000-8000-000000000002',
};
export async function session(uid: string) {
  const token = random();
  await pool.query("INSERT INTO auth_session VALUES($1,$2,now()+interval '1 hour',now())", [
    hash(token),
    uid,
  ]);
  return `session=${signed(token)}`;
}
export const asActor = <T>(actor: string, fn: Parameters<typeof transaction<T>>[1]) =>
  transaction(actor, fn);
export const origin = 'http://localhost:5173';
