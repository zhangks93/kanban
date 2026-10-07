import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, random, signed, cookieOptions } from '../middleware/auth';
import { pool } from '../lib/db';
import { AppError } from '../lib/errors';
export function safeNext(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return '/my';
  return value;
}
async function feishu(path: string, init?: RequestInit) {
  const response = await fetch(
    `${process.env.FEISHU_BASE_URL ?? 'https://open.feishu.cn'}${path}`,
    { ...init, signal: AbortSignal.timeout(10000) },
  );
  const data = (await response.json()) as { code?: number; data?: any; app_access_token?: string };
  if (!response.ok || data.code) throw new AppError('UNAUTHENTICATED');
  return data;
}
export async function registerAuth(app: FastifyInstance) {
  if (process.env.NODE_ENV === 'production' && process.env.FEISHU_BASE_URL)
    throw Error('Fake Feishu override is forbidden in production');
  app.get('/auth/feishu/start', async (req, reply) => {
    const state = random();
    const next = safeNext((req.query as { next?: string }).next);
    await pool.query("INSERT INTO oauth_nonce VALUES($1,$2,now()+interval '10 minutes')", [
      hash(state),
      next,
    ]);
    reply.setCookie('oauth_state', state, { ...cookieOptions, maxAge: 600 });
    const url = new URL(
      process.env.FEISHU_BASE_URL
        ? `${process.env.FEISHU_BASE_URL}/authorize`
        : 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    );
    url.searchParams.set('app_id', process.env.FEISHU_APP_ID ?? 'fake');
    url.searchParams.set('redirect_uri', `${process.env.APP_BASE_URL}/auth/feishu/callback`);
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });
  app.get('/auth/feishu/callback', async (req, reply) => {
    const query = z.object({ state: z.string(), code: z.string() }).parse(req.query);
    if (req.cookies.oauth_state !== query.state) throw new AppError('UNAUTHENTICATED');
    const nonce = (
      await pool.query(
        'DELETE FROM oauth_nonce WHERE state_hash=$1 AND expires_at>now() RETURNING next_path',
        [hash(query.state)],
      )
    ).rows[0];
    if (!nonce) throw new AppError('UNAUTHENTICATED');
    reply.clearCookie('oauth_state', cookieOptions);
    const appToken = await feishu('/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
    });
    const access = await feishu('/open-apis/authen/v1/access_token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${appToken.app_access_token}`,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code: query.code }),
    });
    const profile = (
      await feishu('/open-apis/authen/v1/user_info', {
        headers: { Authorization: `Bearer ${access.data.access_token}` },
      })
    ).data as {
      open_id: string;
      user_id?: string;
      union_id?: string;
      name: string;
      avatar_url?: string;
      email?: string;
    };
    if (!profile.open_id || !profile.name) throw new AppError('UNAUTHENTICATED');
    const user = (
      await pool.query(
        'INSERT INTO app_user(feishu_open_id,feishu_user_id,feishu_union_id,display_name,avatar_url,email,last_login_at,is_platform_admin) VALUES($1,$2,$3,$4,$5,$6,now(),$7) ON CONFLICT(feishu_open_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,email=EXCLUDED.email,last_login_at=now() RETURNING *',
        [
          profile.open_id,
          profile.user_id,
          profile.union_id,
          profile.name,
          profile.avatar_url,
          profile.email,
          profile.open_id === process.env.BOOTSTRAP_PLATFORM_ADMIN_FEISHU_ID,
        ],
      )
    ).rows[0];
    if (user.status !== 'active') throw new AppError('UNAUTHENTICATED');
    const token = random();
    await pool.query(
      "INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [hash(token), user.id],
    );
    reply.setCookie('session', signed(token), { ...cookieOptions, maxAge: 43200 });
    return reply.redirect(safeNext(nonce.next_path));
  });
  app.post('/auth/logout', async (req, reply) => {
    await pool.query('DELETE FROM auth_session WHERE user_id=$1', [req.actor.id]);
    reply.clearCookie('session', cookieOptions);
    return { ok: true };
  });
  app.get('/api/me', async (req) => req.actor);
}
