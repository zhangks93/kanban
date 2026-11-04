import { afterAll, expect, test } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
import { coreTemplates } from '../packages/plugin-sdk/src';
import { manifest as rnd } from '../packages/plugin-rnd/src/manifest';
import { manifest as ops } from '../packages/plugin-ops/src/manifest';
import { asActor, ids, origin, session } from './helpers';

const templates = [...coreTemplates, ...rnd.boardTemplates!, ...ops.boardTemplates!];
afterAll(() => pool.end());
async function createBoard(key: string) {
  return asActor(
    ids.a,
    async (db) =>
      (
        await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
          ids.alpha,
          `S${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          '分享测试',
          'workspace',
          templates.find((t) => t.key === key),
        ])
      ).rows[0],
  );
}

test('only board managers can share; the public response is a read-only whitelist and rotation/revocation invalidates old links', async () => {
  const app = await buildApp();
  const board = await createBoard('rnd.development');
  const manager = await session(ids.a);
  const member = await session(ids.b);
  try {
    const secret = `private-${crypto.randomUUID()}`;
    await asActor(ids.a, async (db) => {
      await db.query('SELECT create_task($1,$2)', [
        board.id,
        {
          title: '公开进度',
          descriptionText: secret,
          responsibleUserId: ids.a,
          clientMutationId: crypto.randomUUID(),
        },
      ]);
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/boards/${board.id}/share`,
          headers: { cookie: member, origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/share`,
      headers: { cookie: manager, origin },
      payload: {},
    });
    expect(created.statusCode).toBe(200);
    const { token, url } = created.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url).toBe(`${origin}/share/${token}`);
    const stored = (
      await pool.query('SELECT * FROM board_public_share WHERE board_id=$1', [board.id])
    ).rows[0];
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);
    const viewed = await app.inject({ url: `/api/public/boards/${token}` });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.headers['cache-control']).toBe('no-store');
    expect(viewed.json().submissionKind).toBe('requirement');
    expect(Object.keys(viewed.json().board).sort()).toEqual(['key', 'name', 'plugin_key']);
    expect(Object.keys(viewed.json().tasks[0]).sort()).toEqual([
      'due_date',
      'id',
      'lane_id',
      'priority',
      'seq',
      'state_id',
      'title',
      'type_name',
    ]);
    expect(viewed.body).not.toContain(secret);
    expect(viewed.body).not.toContain(ids.a);
    expect((await app.inject({ url: `/api/boards/${board.id}` })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/boards/${board.id}`,
          headers: { origin },
          payload: { name: 'tampered' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/public/boards/${token}/tasks`,
          headers: { origin },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    const rotated = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/share`,
      headers: { cookie: manager, origin },
      payload: { regenerate: true },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().token).not.toBe(token);
    expect((await app.inject({ url: `/api/public/boards/${token}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/public/boards/${rotated.json().token}` })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/boards/${board.id}/share`,
          headers: { cookie: manager, origin },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `/api/public/boards/${rotated.json().token}` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/public/boards/${rotated.json().token}/submissions`,
          headers: { origin },
          payload: {
            title: 'revoked',
            requesterName: 'guest',
            clientMutationId: crypto.randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test('guest submissions are validated, deduplicated, privately triaged and accepted as the correct task type', async () => {
  const app = await buildApp();
  const board = await createBoard('rnd.development');
  const manager = await session(ids.a);
  const member = await session(ids.b);
  try {
    const shared = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/share`,
      headers: { cookie: manager, origin },
      payload: {},
    });
    const url = `/api/public/boards/${shared.json().token}/submissions`;
    const body = {
      title: '访客需求',
      description: '新增一个筛选入口',
      requesterName: '访客姓名',
      contact: 'private@example.com',
      clientMutationId: crypto.randomUUID(),
    };
    expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { origin: 'https://other.example' },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { origin },
          payload: { ...body, responsibleUserId: ids.a, status: 'accepted' },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { origin },
          payload: { ...body, title: '   ' },
        })
      ).statusCode,
    ).toBe(422);
    const result = await app.inject({ method: 'POST', url, headers: { origin }, payload: body });
    expect(result.statusCode).toBe(201);
    expect(Object.keys(result.json()).sort()).toEqual(['id', 'status']);
    expect(result.json().status).toBe('pending');
    expect(
      (await app.inject({ method: 'POST', url, headers: { origin }, payload: body })).json(),
    ).toEqual(result.json());
    const stored = (
      await pool.query('SELECT * FROM intake_request WHERE id=$1', [result.json().id])
    ).rows[0];
    expect(stored.requester_id).toBeNull();
    expect(stored.guest_name).toBe(body.requesterName);
    expect(stored.source).toBe('public');
    const intake = await app.inject({
      url: `/api/boards/${board.id}/intake`,
      headers: { cookie: manager },
    });
    expect(intake.json().find((r: { id: string }) => r.id === stored.id).requester_name).toBe(
      body.requesterName,
    );
    expect(
      (
        await app.inject({ url: `/api/boards/${board.id}/intake`, headers: { cookie: member } })
      ).json(),
    ).toEqual([]);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/intake/${stored.id}/accept`,
      headers: { cookie: manager, origin },
      payload: { responsibleUserId: ids.a },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');
    const task = (
      await pool.query(
        'SELECT t.*,ty.key AS type_key FROM task t JOIN board_task_type ty ON ty.id=t.type_id WHERE t.id=$1',
        [accepted.json().task_id],
      )
    ).rows[0];
    expect(task.type_key).toBe('story');
    expect(task.requester_id).toBeNull();
    expect(task.description_text).toBe(body.description);
    const publicView = await app.inject({ url: `/api/public/boards/${shared.json().token}` });
    expect(publicView.body).not.toContain(body.contact);
    expect(publicView.body).not.toContain(body.requesterName);
    expect(publicView.body).not.toContain(body.description);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/intake/${stored.id}/accept`,
          headers: { cookie: manager, origin },
          payload: { responsibleUserId: ids.a },
        })
      ).json().task_id,
    ).toBe(task.id);
  } finally {
    await app.close();
  }
});

test('ops exposes a ticket entry, core boards reject guest submission, and archived boards revoke visibility', async () => {
  const app = await buildApp();
  const manager = await session(ids.a);
  try {
    for (const [key, kind] of [
      ['ops.operations', 'ticket'],
      ['core.general', null],
    ] as const) {
      const board = await createBoard(key);
      const shared = await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/share`,
        headers: { cookie: manager, origin },
        payload: {},
      });
      const token = shared.json().token;
      expect((await app.inject({ url: `/api/public/boards/${token}` })).json().submissionKind).toBe(
        kind,
      );
      const response = await app.inject({
        method: 'POST',
        url: `/api/public/boards/${token}/submissions`,
        headers: { origin },
        payload: {
          title: '故障提报',
          requesterName: '访客',
          clientMutationId: crypto.randomUUID(),
        },
      });
      expect(response.statusCode).toBe(kind ? 201 : 403);
      if (kind) {
        const accepted = await app.inject({
          method: 'POST',
          url: `/api/intake/${response.json().id}/accept`,
          headers: { cookie: manager, origin },
          payload: { responsibleUserId: ids.a },
        });
        expect(accepted.statusCode).toBe(200);
        expect(
          (
            await pool.query(
              'SELECT ty.key FROM task t JOIN board_task_type ty ON ty.id=t.type_id WHERE t.id=$1',
              [accepted.json().task_id],
            )
          ).rows[0].key,
        ).toBe('incident');
      }
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: { cookie: manager, origin },
      });
      expect((await app.inject({ url: `/api/public/boards/${token}` })).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/public/boards/${token}/submissions`,
            headers: { origin },
            payload: {
              title: '故障提报',
              requesterName: '访客',
              clientMutationId: crypto.randomUUID(),
            },
          })
        ).statusCode,
      ).toBe(404);
    }
  } finally {
    await app.close();
  }
});

test('public intake applies a durable per-board quota while preserving safe retries', async () => {
  const app = await buildApp();
  const board = await createBoard('ops.operations');
  const manager = await session(ids.a);
  try {
    const shared = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/share`,
      headers: { cookie: manager, origin },
      payload: {},
    });
    const url = `/api/public/boards/${shared.json().token}/submissions`;
    const first = {
      title: '安全重试',
      requesterName: '访客',
      clientMutationId: crypto.randomUUID(),
    };
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({ method: 'POST', url, headers: { origin }, payload: first }),
      ),
    );
    expect(concurrent.every((response) => response.statusCode === 201)).toBe(true);
    expect(new Set(concurrent.map((response) => response.json().id)).size).toBe(1);
    for (let n = 1; n < 10; n++) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { origin },
            payload: { ...first, clientMutationId: crypto.randomUUID() },
          })
        ).statusCode,
      ).toBe(201);
    }
    const limited = await app.inject({
      method: 'POST',
      url,
      headers: { origin },
      payload: { ...first, clientMutationId: crypto.randomUUID() },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(
      (await app.inject({ method: 'POST', url, headers: { origin }, payload: first })).statusCode,
    ).toBe(201);
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM intake_request WHERE board_id=$1 AND source='public'",
          [board.id],
        )
      ).rows[0].count,
    ).toBe('10');
  } finally {
    await app.close();
  }
});

test('public intake trusts forwarded client IPs only from configured proxy addresses', async () => {
  const priorProxyConfig = process.env.TRUSTED_PROXY_CIDRS;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const manager = await session(ids.a);
  async function share(app: (typeof apps)[number]) {
    const board = await createBoard('ops.operations');
    const response = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/share`,
      headers: { cookie: manager, origin },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    return `/api/public/boards/${response.json().token}/submissions`;
  }
  async function submit(
    app: (typeof apps)[number],
    url: string,
    remoteAddress: string,
    forwardedFor: string,
  ) {
    return app.inject({
      method: 'POST',
      url,
      remoteAddress,
      headers: { origin, 'x-forwarded-for': forwardedFor },
      payload: {
        title: '代理限流验证',
        requesterName: '访客',
        clientMutationId: crypto.randomUUID(),
      },
    });
  }
  try {
    delete process.env.TRUSTED_PROXY_CIDRS;
    const direct = await buildApp();
    apps.push(direct);
    const directUrl = await share(direct);
    for (let n = 0; n < 10; n++) {
      expect(
        (await submit(direct, directUrl, '198.51.100.8', `203.0.113.${n + 1}`)).statusCode,
      ).toBe(201);
    }
    // With no trusted proxy, rotating a forged header cannot reset the source IP's quota.
    expect((await submit(direct, directUrl, '198.51.100.8', '203.0.113.200')).statusCode).toBe(429);

    process.env.TRUSTED_PROXY_CIDRS = '127.0.0.1/32';
    const proxied = await buildApp();
    apps.push(proxied);
    const proxiedUrl = await share(proxied);
    for (let n = 0; n < 10; n++) {
      expect((await submit(proxied, proxiedUrl, '127.0.0.1', '203.0.113.10')).statusCode).toBe(201);
    }
    expect((await submit(proxied, proxiedUrl, '127.0.0.1', '203.0.113.10')).statusCode).toBe(429);
    // The known reverse proxy can identify another client with its own allowance.
    expect((await submit(proxied, proxiedUrl, '127.0.0.1', '203.0.113.11')).statusCode).toBe(201);

    const untrustedUrl = await share(proxied);
    for (let n = 0; n < 10; n++) {
      expect(
        (await submit(proxied, untrustedUrl, '198.51.100.70', `203.0.113.${n + 1}`)).statusCode,
      ).toBe(201);
    }
    // Configuring one proxy never grants an unrelated source permission to supply client IPs.
    expect((await submit(proxied, untrustedUrl, '198.51.100.70', '203.0.113.200')).statusCode).toBe(
      429,
    );
  } finally {
    await Promise.all(apps.map((app) => app.close()));
    if (priorProxyConfig === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = priorProxyConfig;
  }
});
