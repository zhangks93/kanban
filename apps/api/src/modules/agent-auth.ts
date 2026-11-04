import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { hash, random, requireAgentAuthorization } from '../middleware/auth';
import { pool, transaction } from '../lib/db';
import { AppError } from '../lib/errors';

const scopesSchema = z
  .array(z.enum(['read', 'write']))
  .min(1)
  .max(2)
  .refine((scopes) => scopes.includes('read') && new Set(scopes).size === scopes.length)
  .transform((scopes): ('read' | 'write')[] =>
    scopes.includes('write') ? ['read', 'write'] : ['read'],
  );
const deviceBody = z
  .object({ clientName: z.string().trim().min(1).max(100), scopes: scopesSchema })
  .strict();
const userCodeSchema = z
  .string()
  .toUpperCase()
  .regex(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
const userCodeHash = (params: unknown) =>
  hash(z.object({ userCode: userCodeSchema }).parse(params).userCode);

function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
  reply.header('referrer-policy', 'no-referrer');
}
function requireHuman(req: FastifyRequest) {
  if (!req.actor || req.agentAuthorization || req.headers.authorization !== undefined)
    throw new AppError('FORBIDDEN');
}

// This counter is deliberately database backed so multiple API processes share
// the same quota. IPs are salted before hashing and never written to the table.
async function limited(
  req: FastifyRequest,
  reply: FastifyReply,
  kind: string,
  limit: number,
  seconds = 60,
) {
  const key = hash(`${process.env.APP_SESSION_SECRET}:${kind}:${req.ip}`);
  const count = (
    await pool.query(
      `INSERT INTO agent_auth_rate_limit(key_hash,window_start,request_count) VALUES($1,now(),1)
       ON CONFLICT(key_hash) DO UPDATE SET
       window_start=CASE WHEN agent_auth_rate_limit.window_start<now()-make_interval(secs=>$2)
         THEN now() ELSE agent_auth_rate_limit.window_start END,
       request_count=CASE WHEN agent_auth_rate_limit.window_start<now()-make_interval(secs=>$2)
         THEN 1 ELSE agent_auth_rate_limit.request_count+1 END RETURNING request_count`,
      [key, seconds],
    )
  ).rows[0].request_count;
  if (count <= limit) return false;
  reply.header('retry-after', seconds);
  reply.code(429).send({
    error: { code: 'RATE_LIMITED', message: '授权请求较频繁，请稍后再试', requestId: req.id },
  });
  return true;
}

export async function registerAgentAuth(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.split('?')[0].startsWith('/api/agent/')) noStore(reply);
  });
  app.addHook('onResponse', async (req, reply) => {
    const authorization = req.agentAuthorization;
    if (!authorization) return;
    try {
      await pool.query(
        `INSERT INTO agent_request_log(authorization_id,actor_id,workspace_id,request_id,method,route,status_code)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          authorization.id,
          authorization.userId,
          authorization.workspaceId,
          req.id,
          req.method,
          req.routeOptions.url ?? '/api/agent/v1/*',
          reply.statusCode,
        ],
      );
      await pool.query('UPDATE agent_authorization SET last_used_at=now() WHERE id=$1', [
        authorization.id,
      ]);
    } catch (error) {
      req.log.error({ err: error, requestId: req.id }, 'could not persist agent request audit');
    }
  });

  app.post('/api/agent/device', { logLevel: 'silent' }, async (req, reply) => {
    noStore(reply);
    if (await limited(req, reply, 'device-start', 20, 600)) return;
    const body = deviceBody.parse(req.body);
    const deviceCode = random();
    const code = randomBytes(6).toString('hex').toUpperCase();
    const userCode = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    // A short retention window supports retries/diagnostics without unbounded
    // accumulation of unauthenticated device requests or obsolete quota keys.
    await pool.query("DELETE FROM agent_device_request WHERE expires_at<now()-interval '1 day'");
    await pool.query("DELETE FROM agent_auth_rate_limit WHERE window_start<now()-interval '1 day'");
    await pool.query(
      `INSERT INTO agent_device_request(device_code_hash,user_code_hash,client_name,scopes)
       VALUES($1,$2,$3,$4)`,
      [hash(deviceCode), hash(userCode), body.clientName, body.scopes],
    );
    const verificationUri = new URL(
      '/agent-access',
      process.env.APP_BASE_URL ?? 'http://localhost:5173',
    );
    verificationUri.searchParams.set('code', userCode);
    return {
      deviceCode,
      userCode,
      verificationUri: verificationUri.href,
      expiresIn: 600,
      interval: 5,
    };
  });

  app.post('/api/agent/device/token', { logLevel: 'silent' }, async (req, reply) => {
    noStore(reply);
    if (await limited(req, reply, 'device-poll', 120)) return;
    const { deviceCode } = z
      .object({ deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(req.body);
    return transaction(null, async (db) => {
      const request = (
        await db.query(
          `SELECT *,expires_at<=now() AS expired FROM agent_device_request
           WHERE device_code_hash=$1 FOR UPDATE`,
          [hash(deviceCode)],
        )
      ).rows[0];
      if (!request || request.expired || request.status === 'consumed')
        return { status: 'expired' };
      if (request.status === 'denied') return { status: 'denied' };
      if (request.status === 'pending') return { status: 'pending' };
      const accessToken = random();
      const authorization = (
        await db.query(
          `UPDATE agent_authorization a SET token_hash=$2 WHERE a.id=$1
           AND a.token_hash IS NULL AND a.revoked_at IS NULL AND a.expires_at>now()
           AND workspace_role(a.user_id,a.workspace_id) IS NOT NULL
           RETURNING a.id,a.client_name AS "clientName",a.scopes,a.workspace_id AS "workspaceId",a.expires_at AS "expiresAt"`,
          [request.authorization_id, hash(accessToken)],
        )
      ).rows[0];
      // The device row lock and single-consumption transition guarantee that
      // concurrent pollers can never obtain two access tokens.
      await db.query(
        "UPDATE agent_device_request SET status='consumed' WHERE device_code_hash=$1",
        [hash(deviceCode)],
      );
      if (!authorization) return { status: 'expired' };
      const { expiresAt, ...metadata } = authorization;
      return {
        status: 'approved',
        accessToken,
        tokenType: 'Bearer',
        expiresAt,
        authorization: metadata,
      };
    });
  });

  app.get('/api/agent/requests/:userCode', { logLevel: 'silent' }, async (req, reply) => {
    noStore(reply);
    requireHuman(req);
    if (await limited(req, reply, 'device-lookup', 60)) return;
    const request = (
      await pool.query(
        `SELECT client_name AS "clientName",scopes,expires_at AS "expiresAt",
         CASE WHEN expires_at<=now() AND status<>'consumed' THEN 'expired'
           WHEN status='consumed' THEN 'approved' ELSE status END AS status
         FROM agent_device_request WHERE user_code_hash=$1`,
        [userCodeHash(req.params)],
      )
    ).rows[0];
    if (!request) throw new AppError('NOT_FOUND');
    return request;
  });

  app.post('/api/agent/requests/:userCode/approve', { logLevel: 'silent' }, async (req, reply) => {
    noStore(reply);
    requireHuman(req);
    const digest = userCodeHash(req.params);
    const body = z
      .object({
        workspaceId: uuid,
        scopes: scopesSchema,
        expiresIn: z.number().int().min(60).max(43200).default(3600),
      })
      .strict()
      .parse(req.body);
    return transaction(req.actor.id, async (db) => {
      const request = (
        await db.query(
          `SELECT * FROM agent_device_request WHERE user_code_hash=$1
           AND status='pending' AND expires_at>now() FOR UPDATE`,
          [digest],
        )
      ).rows[0];
      if (!request) throw new AppError('NOT_FOUND');
      if (body.scopes.some((scope) => !request.scopes.includes(scope)))
        throw new AppError('FORBIDDEN');
      await db.query('SELECT lock_account($1)', [req.actor.id]);
      await db.query('SELECT lock_workspace($1)', [body.workspaceId]);
      if (
        !(await db.query('SELECT workspace_role($1,$2) AS role', [req.actor.id, body.workspaceId]))
          .rows[0].role
      )
        throw new AppError('NOT_FOUND');
      const authorization = (
        await db.query(
          `INSERT INTO agent_authorization(user_id,workspace_id,client_name,scopes,expires_at)
           VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5)) RETURNING id`,
          [req.actor.id, body.workspaceId, request.client_name, body.scopes, body.expiresIn],
        )
      ).rows[0];
      await db.query(
        `UPDATE agent_device_request SET status='approved',authorization_id=$2,decided_by=$3
         WHERE user_code_hash=$1`,
        [digest, authorization.id, req.actor.id],
      );
      return { ok: true };
    });
  });

  app.post('/api/agent/requests/:userCode/deny', { logLevel: 'silent' }, async (req, reply) => {
    noStore(reply);
    requireHuman(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const result = await pool.query(
      `UPDATE agent_device_request SET status='denied',decided_by=$2
       WHERE user_code_hash=$1 AND status='pending' AND expires_at>now() RETURNING device_code_hash`,
      [userCodeHash(req.params), req.actor.id],
    );
    if (!result.rowCount) throw new AppError('NOT_FOUND');
    return { ok: true };
  });

  app.get('/api/agent/authorizations', async (req, reply) => {
    noStore(reply);
    requireHuman(req);
    return (
      await pool.query(
        `SELECT a.id,a.client_name AS "clientName",a.scopes,a.workspace_id AS "workspaceId",
         w.name AS "workspaceName",a.created_at AS "createdAt",a.expires_at AS "expiresAt",
         a.last_used_at AS "lastUsedAt",a.revoked_at AS "revokedAt"
         FROM agent_authorization a JOIN workspace w ON w.id=a.workspace_id
         WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 200`,
        [req.actor.id],
      )
    ).rows;
  });

  app.post('/api/agent/authorizations/:id/revoke', async (req, reply) => {
    noStore(reply);
    requireHuman(req);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const id = z.object({ id: uuid }).parse(req.params).id;
    return transaction(req.actor.id, async (db) => {
      const result = await db.query(
        'UPDATE agent_authorization SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id',
        [id, req.actor.id],
      );
      if (!result.rowCount) throw new AppError('NOT_FOUND');
      return { ok: true };
    });
  });

  app.delete('/api/agent/v1/authorization', async (req, reply) => {
    noStore(reply);
    const authorization = requireAgentAuthorization(req);
    return transaction(req.actor.id, async (db) => {
      await db.query('UPDATE agent_authorization SET revoked_at=now() WHERE id=$1', [
        authorization.id,
      ]);
      return { ok: true };
    });
  });
}
