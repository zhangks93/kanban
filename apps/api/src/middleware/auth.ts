import cookie from '@fastify/cookie';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '@work/shared';
import { pool } from '../lib/db';
import { AppError } from '../lib/errors';
import { requestContext } from '../lib/request-context';
import { getCloudBaseConfig } from '../lib/cloudbase-config';
import { authStore } from '../lib/auth-store';
export interface AgentAuthorization {
  id: string;
  userId: string;
  workspaceId: string;
  scopes: ('read' | 'write')[];
  clientName: string;
}
declare module 'fastify' {
  interface FastifyRequest {
    actor: User;
    agentAuthorization: AgentAuthorization | null;
  }
}
export function requireAgentAuthorization(req: FastifyRequest): AgentAuthorization {
  if (!req.agentAuthorization) throw new AppError('UNAUTHENTICATED');
  return req.agentAuthorization;
}
export function requireAgentWrite(req: FastifyRequest): AgentAuthorization {
  const authorization = requireAgentAuthorization(req);
  if (!authorization.scopes.includes('write')) throw new AppError('FORBIDDEN');
  return authorization;
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
export function sessionHash(cookie: string | undefined) {
  const token = cookie ? verified(cookie) : null;
  return token ? hash(token) : null;
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
  app.decorateRequest('agentAuthorization', null);
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const path = req.url.split('?')[0];
    if (path === '/api/agent/v1' || path.startsWith('/api/agent/v1/')) {
      // Bearer authentication is confined to the versioned Agent API. A cookie
      // must never silently turn an unapproved CLI into an authenticated client.
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      if (!match) throw new AppError('UNAUTHENTICATED');
      if (getCloudBaseConfig()) return; // The server-signed RPC checks the grant in CloudBase.
      const result = await pool.query(
        `SELECT u.*,wip_usage(u.id) AS used_wip,a.id AS agent_id,
         a.workspace_id AS agent_workspace_id,a.scopes AS agent_scopes,a.client_name AS agent_client_name
         FROM agent_authorization a JOIN app_user u ON u.id=a.user_id
         WHERE a.token_hash=$1 AND a.expires_at>now() AND a.revoked_at IS NULL
         AND u.status='active' AND workspace_role(u.id,a.workspace_id) IS NOT NULL`,
        [hash(match[1])],
      );
      const row = result.rows[0];
      if (!row) throw new AppError('UNAUTHENTICATED');
      req.actor = row;
      req.agentAuthorization = {
        id: row.agent_id,
        userId: row.id,
        workspaceId: row.agent_workspace_id,
        scopes: row.agent_scopes,
        clientName: row.agent_client_name,
      };
      const context = requestContext.getStore();
      if (context) context.agentAuthorizationId = row.agent_id;
      return;
    }
    // In particular, a bearer token cannot approve or extend its own delegation,
    // or reach the human application's broader administration API.
    if (req.headers.authorization !== undefined) throw new AppError('FORBIDDEN');
    if (
      req.method === 'POST' &&
      (path === '/api/agent/device' || path === '/api/agent/device/token')
    ) {
      if (
        req.headers.origin !== undefined &&
        req.headers.origin !== new URL(process.env.APP_BASE_URL ?? 'http://localhost:5173').origin
      )
        throw new AppError('FORBIDDEN');
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== new URL(process.env.APP_BASE_URL ?? 'http://localhost:5173').origin
      )
        throw new AppError('FORBIDDEN');
    }
    if (req.url.startsWith('/auth/feishu/') || req.url.startsWith('/api/health')) return;
    if (
      (req.method === 'GET' && /^\/api\/public\/boards\/[^/]+$/.test(path)) ||
      (req.method === 'POST' && /^\/api\/public\/boards\/[^/]+\/submissions$/.test(path))
    )
      return;
    const digest = sessionHash(req.cookies.session);
    if (!digest) throw new AppError('UNAUTHENTICATED');
    if (getCloudBaseConfig() && path.startsWith('/api/')) return;
    const user = await authStore.findSession(digest);
    if (!user) throw new AppError('UNAUTHENTICATED');
    req.actor = user;
  });
}
