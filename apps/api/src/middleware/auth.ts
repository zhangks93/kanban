import cookie from '@fastify/cookie';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '@work/shared';
import { pool } from '../lib/db';
import { AppError } from '../lib/errors';
declare module 'fastify' {
  interface FastifyRequest {
    actor: User;
  }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
function secret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 32)
    throw new Error('APP_SESSION_SECRET must contain at least 32 characters');
  return value;
}
export function signed(token: string) {
  return `${token}.${createHmac('sha256', secret()).update(token).digest('base64url')}`;
}
function verified(value: string) {
  const split = value.lastIndexOf('.');
  if (split < 0) return null;
  const token = value.slice(0, split);
  const expected = Buffer.from(signed(token));
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? token : null;
}
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
export async function registerAuthMiddleware(app: FastifyInstance) {
  secret();
  await app.register(cookie);
  app.decorateRequest('actor', null as unknown as User);
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== new URL(process.env.APP_BASE_URL ?? 'http://localhost:5173').origin
      )
        throw new AppError('FORBIDDEN');
    }
    if (req.url.startsWith('/auth/feishu/') || req.url.startsWith('/api/health')) return;
    const token = req.cookies.session ? verified(req.cookies.session) : null;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const result = await pool.query(
      "SELECT u.*,wip_usage(u.id) AS used_wip FROM auth_session s JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'",
      [hash(token)],
    );
    if (!result.rows[0]) throw new AppError('UNAUTHENTICATED');
    req.actor = result.rows[0];
  });
}
