import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { uuid } from '@work/shared';
import { hash, random } from '../middleware/auth';
import { transaction } from '../lib/db';
import { AppError } from '../lib/errors';
import { manageBoard } from './boards';

function submissionKind(pluginKey: string | null) {
  return pluginKey === 'rnd' ? 'requirement' : pluginKey === 'ops' ? 'ticket' : null;
}
function publicHeaders(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-robots-tag', 'noindex, nofollow');
}
function tokenHash(params: unknown) {
  const token = (params as { token?: string }).token;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('NOT_FOUND');
  return hash(token);
}
async function sharedBoard(db: pg.PoolClient, digest: string, write = false) {
  const initial = (
    await db.query(
      'SELECT b.id,b.workspace_id FROM board_public_share s JOIN board b ON b.id=s.board_id WHERE s.token_hash=$1',
      [digest],
    )
  ).rows[0];
  if (!initial) throw new AppError('NOT_FOUND');
  await db.query('SELECT lock_workspace($1)', [initial.workspace_id]);
  await db.query('SELECT lock_board($1,$2)', [initial.id, write]);
  const board = (
    await db.query(
      `SELECT b.id,b.workspace_id,b.name,b.key,b.plugin_key,s.created_at,s.updated_at
       FROM board_public_share s JOIN board b ON b.id=s.board_id
       JOIN workspace w ON w.id=b.workspace_id
       WHERE s.token_hash=$1 AND s.enabled AND b.status='active' AND w.status='active'
       AND (b.plugin_key IS NULL OR EXISTS(SELECT 1 FROM workspace_plugin p WHERE p.workspace_id=b.workspace_id AND p.plugin_key=b.plugin_key))`,
      [digest],
    )
  ).rows[0];
  if (!board) throw new AppError('NOT_FOUND');
  return board;
}

export async function registerBoardSharing(app: FastifyInstance) {
  app.get('/api/boards/:boardId/share', async (req) => {
    const bid = uuid.parse((req.params as { boardId: string }).boardId);
    return manageBoard(req.actor.id, bid, async (db) => {
      const board = (await db.query('SELECT plugin_key FROM board WHERE id=$1', [bid])).rows[0];
      const share = (
        await db.query(
          'SELECT enabled,created_at,updated_at FROM board_public_share WHERE board_id=$1',
          [bid],
        )
      ).rows[0];
      return {
        enabled: share?.enabled ?? false,
        createdAt: share?.created_at ?? null,
        updatedAt: share?.updated_at ?? null,
        submissionKind: submissionKind(board.plugin_key),
      };
    });
  });
  app.post('/api/boards/:boardId/share', async (req) => {
    const bid = uuid.parse((req.params as { boardId: string }).boardId);
    const body = z
      .object({ regenerate: z.boolean().optional() })
      .strict()
      .parse(req.body ?? {});
    return manageBoard(req.actor.id, bid, async (db) => {
      const board = (await db.query('SELECT plugin_key FROM board WHERE id=$1', [bid])).rows[0];
      const prior = (
        await db.query(
          'SELECT enabled,created_at,updated_at FROM board_public_share WHERE board_id=$1',
          [bid],
        )
      ).rows[0];
      if (prior?.enabled && !body.regenerate) {
        return {
          enabled: true,
          createdAt: prior.created_at,
          updatedAt: prior.updated_at,
          submissionKind: submissionKind(board.plugin_key),
        };
      }
      const token = random();
      const share = (
        await db.query(
          `INSERT INTO board_public_share(board_id,token_hash,created_by) VALUES($1,$2,$3)
           ON CONFLICT(board_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,enabled=true,created_by=EXCLUDED.created_by,updated_at=now()
           RETURNING created_at,updated_at`,
          [bid, hash(token), req.actor.id],
        )
      ).rows[0];
      return {
        enabled: true,
        token,
        url: new URL(`/share/${token}`, process.env.APP_BASE_URL ?? 'http://localhost:5173').href,
        createdAt: share.created_at,
        updatedAt: share.updated_at,
        submissionKind: submissionKind(board.plugin_key),
      };
    });
  });
  app.delete('/api/boards/:boardId/share', async (req) => {
    const bid = uuid.parse((req.params as { boardId: string }).boardId);
    return manageBoard(req.actor.id, bid, async (db) => {
      await db.query(
        'UPDATE board_public_share SET enabled=false,updated_at=now() WHERE board_id=$1',
        [bid],
      );
      return { ok: true };
    });
  });
  app.get('/api/public/boards/:token', { logLevel: 'silent' }, async (req, reply) => {
    publicHeaders(reply);
    const digest = tokenHash(req.params);
    return transaction(null, async (db) => {
      const board = await sharedBoard(db, digest);
      const states = (
        await db.query(
          'SELECT id,name,state_group,sort_order FROM board_state WHERE board_id=$1 ORDER BY sort_order',
          [board.id],
        )
      ).rows;
      const lanes = (
        await db.query(
          "SELECT id,name,sort_order FROM board_lane WHERE board_id=$1 AND status='active' ORDER BY sort_order",
          [board.id],
        )
      ).rows;
      const tasks = (
        await db.query(
          `SELECT t.id,t.seq,t.title,t.state_id,t.lane_id,ty.name AS type_name,t.priority,t.due_date
         FROM task t JOIN board_task_type ty ON ty.id=t.type_id AND ty.board_id=t.board_id
         WHERE t.board_id=$1 AND t.deleted_at IS NULL ORDER BY t.sort_key,t.id`,
          [board.id],
        )
      ).rows;
      return {
        board: { name: board.name, key: board.key, plugin_key: board.plugin_key },
        states,
        lanes,
        tasks,
        submissionKind: submissionKind(board.plugin_key),
      };
    });
  });
  app.post(
    '/api/public/boards/:token/submissions',
    { logLevel: 'silent', bodyLimit: 32768 },
    async (req, reply) => {
      publicHeaders(reply);
      const digest = tokenHash(req.params);
      const body = z
        .object({
          title: z.string().trim().min(1).max(255),
          description: z.string().trim().max(10000).optional(),
          expectedDate: z.string().date().optional(),
          requesterName: z.string().trim().min(1).max(100),
          contact: z.string().trim().max(200).optional(),
          clientMutationId: uuid,
        })
        .strict()
        .parse(req.body);
      const result = await transaction(null, async (db) => {
        const board = await sharedBoard(db, digest, true);
        if (!submissionKind(board.plugin_key)) throw new AppError('FORBIDDEN');
        const existing = (
          await db.query(
            "SELECT id,status FROM intake_request WHERE board_id=$1 AND source='public' AND client_mutation_id=$2",
            [board.id, body.clientMutationId],
          )
        ).rows[0];
        if (existing) return existing;
        // The quota is durable across API processes; retries of the same request do not consume it.
        const count = Number(
          (
            await db.query(
              "SELECT count(*) FROM intake_request WHERE board_id=$1 AND source='public' AND public_ip_hash=$2 AND created_at>now()-interval '10 minutes'",
              [board.id, hash(`${board.id}:${req.ip}`)],
            )
          ).rows[0].count,
        );
        if (count >= 10) return null;
        return (
          await db.query(
            `INSERT INTO intake_request(workspace_id,board_id,requester_id,title,description,expected_date,client_mutation_id,source,guest_name,guest_contact,public_ip_hash)
         VALUES($1,$2,NULL,$3,$4,$5,$6,'public',$7,$8,$9) RETURNING id,status`,
            [
              board.workspace_id,
              board.id,
              body.title,
              body.description,
              body.expectedDate,
              body.clientMutationId,
              body.requesterName,
              body.contact,
              hash(`${board.id}:${req.ip}`),
            ],
          )
        ).rows[0];
      });
      if (!result)
        return reply
          .code(429)
          .send({ error: { code: 'RATE_LIMITED', message: '提交较频繁，请稍后再试' } });
      return reply.code(201).send(result);
    },
  );
}
