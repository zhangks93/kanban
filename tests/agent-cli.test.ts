import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliIO } from '../packages/cli/src/cli';
import {
  normalizeServer,
  readCredentials,
  saveCredentials,
  readPending,
  savePending,
  pendingFile,
} from '../packages/cli/src/config';

const taskId = '90000000-0000-4000-8000-000000000001';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'work-cli-'));
  directories.push(directory);
  let now = Date.now();
  const output: string[] = [];
  const errors: string[] = [];
  const io: CliIO = {
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
    stdin: async () => '{}',
    wait: async (milliseconds) => {
      now += milliseconds;
    },
    now: () => now,
  };
  const env = {
    WORK_CONFIG_DIR: directory,
    WORK_SERVER: 'https://work.example.com',
    WORK_TOKEN: 'secret-token',
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ items: [], nextCursor: null }));
  return { directory, io, output, errors, env, fetcher };
}

test('CLI rejects unsafe server origins and never sends credentials to an overridden server', async () => {
  for (const url of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/api',
    'https://example.com/?token=x',
    'https://example.com/#x',
    'file:///tmp/example',
  ])
    expect(() => normalizeServer(url)).toThrow();
  expect(normalizeServer('http://localhost:5173/')).toBe('http://localhost:5173');
  const h = await harness();
  await saveCredentials(h.env, {
    server: 'https://work.example.com',
    accessToken: 'saved-token',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const code = await runCli(
    ['me', '--server', 'https://other.example.com'],
    h.io,
    { WORK_CONFIG_DIR: h.directory },
    h.fetcher,
  );
  expect(code).toBe(3);
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.errors.join('')).not.toContain('saved-token');
});

test('CLI encodes filters, requires bearer, rejects redirects, and returns bounded page unchanged', async () => {
  const h = await harness();
  const code = await runCli(
    ['tasks', 'list', '--q', 'foo&bar', '--limit', '20', '--board', taskId],
    h.io,
    h.env,
    h.fetcher,
  );
  expect(code).toBe(0);
  const [url, options] = h.fetcher.mock.calls[0];
  expect(new URL(String(url)).searchParams.get('q')).toBe('foo&bar');
  expect(new URL(String(url)).searchParams.get('limit')).toBe('20');
  expect(options?.redirect).toBe('error');
  expect(options?.headers).toMatchObject({ authorization: 'Bearer secret-token' });
  expect(JSON.parse(h.output[0])).toEqual({ data: { items: [], nextCursor: null } });
  expect(h.output.join('')).not.toContain('secret-token');
});

test('CLI validates mutations before network and dry-run performs no request', async () => {
  const h = await harness();
  expect(
    await runCli(['tasks', 'update', taskId, '--json', '{"title":"new"}'], h.io, h.env, h.fetcher),
  ).toBe(2);
  expect(
    await runCli(['tasks', 'delete', taskId, '--expected-version', '2'], h.io, h.env, h.fetcher),
  ).toBe(2);
  expect(
    await runCli(
      ['tasks', 'create', '--board', taskId, '--json', '{"title":"new"}'],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(2);
  expect(
    await runCli(
      ['tasks', 'update', taskId, '--json', '{"title":"new","expectedVersion":2}', '--dry-run'],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(0);
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(JSON.parse(h.output[0]).data).toMatchObject({
    dryRun: true,
    method: 'PATCH',
    body: { expectedVersion: 2, title: 'new' },
  });
});

test('CLI exposes server conflict code and request ID without retrying', async () => {
  const h = await harness();
  h.fetcher.mockResolvedValue(
    Response.json(
      { error: { code: 'VERSION_CONFLICT', message: 'refresh', requestId: 'request-1' } },
      { status: 409 },
    ),
  );
  const result = await runCli(
    ['tasks', 'update', taskId, '--json', '{"title":"new","expectedVersion":2}'],
    h.io,
    h.env,
    h.fetcher,
  );
  expect(result).toBe(5);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(h.errors[0])).toEqual({
    error: { code: 'VERSION_CONFLICT', message: 'refresh', requestId: 'request-1' },
  });
});

test('device login waits for approval and persists secret with restrictive permissions without printing it', async () => {
  const h = await harness();
  h.fetcher
    .mockResolvedValueOnce(
      Response.json({
        deviceCode: 'device-secret',
        userCode: 'ABCD-1234-EF56',
        verificationUri: 'https://work.example.com/agent-access?code=ABCD-1234-EF56',
        expiresIn: 600,
        interval: 5,
      }),
    )
    .mockResolvedValueOnce(Response.json({ status: 'pending' }))
    .mockResolvedValueOnce(
      Response.json({
        status: 'approved',
        accessToken: 'approved-secret',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        authorization: { id: taskId, scopes: ['read'], workspaceId: taskId },
      }),
    );
  const result = await runCli(
    ['auth', 'login', '--name', 'test-agent'],
    h.io,
    { WORK_CONFIG_DIR: h.directory, WORK_SERVER: h.env.WORK_SERVER },
    h.fetcher,
  );
  expect(result).toBe(0);
  expect((await readCredentials(h.env))?.accessToken).toBe('approved-secret');
  const credentialsPath = join(h.directory, 'credentials.json');
  expect(await readFile(credentialsPath, 'utf8')).toContain('approved-secret');
  if (process.platform !== 'win32') {
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
    expect((await stat(h.directory)).mode & 0o777).toBe(0o700);
  }
  expect(h.output.join('') + h.errors.join('')).not.toContain('approved-secret');
  expect(h.output.join('') + h.errors.join('')).not.toContain('device-secret');
  expect(h.errors[0]).toContain('ABCD-1234-EF56');
  expect(
    h.fetcher.mock.calls.every(
      ([, options]) => !(options?.headers as Record<string, string>)?.authorization,
    ),
  ).toBe(true);
});

test('logout retains credentials when remote revocation fails and removes them after success', async () => {
  const h = await harness();
  const env = { WORK_CONFIG_DIR: h.directory };
  await saveCredentials(env, {
    server: h.env.WORK_SERVER,
    accessToken: 'saved-token',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  h.fetcher.mockRejectedValueOnce(new Error('offline'));
  expect(await runCli(['auth', 'logout'], h.io, env, h.fetcher)).toBe(6);
  expect((await readCredentials(env))?.accessToken).toBe('saved-token');
  h.fetcher.mockResolvedValueOnce(Response.json({ ok: true }));
  expect(await runCli(['auth', 'logout'], h.io, env, h.fetcher)).toBe(0);
  expect(JSON.parse(h.output[0]).data.remoteStatus).toBe('revoked');
  expect(await readCredentials(env)).toBeUndefined();
});

test('unknown command options fail without reading config or making requests; help requires no auth', async () => {
  const h = await harness();
  expect(await runCli(['tasks', 'list', '--write'], h.io, h.env, h.fetcher)).toBe(2);
  expect(await runCli(['--help'], h.io, {}, h.fetcher)).toBe(0);
  expect(h.fetcher).not.toHaveBeenCalled();
});

test('logout of an environment token preserves a different saved authorization', async () => {
  const h = await harness();
  await saveCredentials(h.env, {
    server: h.env.WORK_SERVER,
    accessToken: 'different-saved-token',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  expect(await runCli(['auth', 'logout'], h.io, h.env, h.fetcher)).toBe(0);
  expect((await readCredentials(h.env))?.accessToken).toBe('different-saved-token');
  expect(JSON.parse(h.output[0]).data.savedCredentialsRetained).toBe(true);
  expect(h.fetcher.mock.calls[0][1]?.headers).toMatchObject({
    authorization: 'Bearer secret-token',
  });
});

test('logout distinguishes unavailable authentication from confirmed remote revocation', async () => {
  const h = await harness();
  await saveCredentials(h.env, {
    server: h.env.WORK_SERVER,
    accessToken: h.env.WORK_TOKEN,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  h.fetcher.mockResolvedValueOnce(
    Response.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Inactive membership' } },
      { status: 401 },
    ),
  );
  expect(await runCli(['auth', 'logout'], h.io, h.env, h.fetcher)).toBe(0);
  expect(await readCredentials(h.env)).toBeUndefined();
  const data = JSON.parse(h.output[0]).data;
  expect(data.remoteStatus).toBe('unavailable');
  expect(data.warning).toContain('could not be confirmed');
  expect(data.note).toBe('Remove WORK_TOKEN from the caller environment');
  expect(h.output.join('')).not.toContain('Token revoked');
});

test('commands, exact schemas, and allowlisted bundled skills are discoverable without auth', async () => {
  const h = await harness();
  for (const args of [
    ['commands', '--json'],
    ['schema'],
    ['schema', 'tasks.update'],
    ['skills', 'list'],
  ])
    expect(await runCli(args, h.io, {}, h.fetcher)).toBe(0);
  const commands = JSON.parse(h.output[0]).data.commands;
  expect(commands.some((item: { id: string }) => item.id === 'tasks.+mine')).toBe(true);
  const schema = JSON.parse(h.output[2]).data;
  expect(schema.operation.id).toBe('tasks.update');
  expect(schema.operation.body.required).toContain('expectedVersion');
  expect(await runCli(['skills', 'read', 'work-shared'], h.io, {}, h.fetcher)).toBe(0);
  expect(h.output.at(-1)).toContain('work-shared');
  expect(await runCli(['skills', 'read', '../../etc/passwd'], h.io, {}, h.fetcher)).toBe(2);
  expect(await runCli(['schema', 'arbitrary.unknown'], h.io, {}, h.fetcher)).toBe(2);
  expect(h.fetcher).not.toHaveBeenCalled();
});

test('global server options before commands preserve discovery JSON flags and task JSON values', async () => {
  const h = await harness();
  for (const prefix of [['--server', h.env.WORK_SERVER], [`--server=${h.env.WORK_SERVER}`]]) {
    expect(await runCli([...prefix, 'commands', '--json'], h.io, {}, h.fetcher)).toBe(0);
    expect(JSON.parse(h.output.at(-1)!).data.commands).toEqual(expect.any(Array));
  }
  expect(
    await runCli(
      ['--server', h.env.WORK_SERVER, 'commands', '--json', '--json'],
      h.io,
      {},
      h.fetcher,
    ),
  ).toBe(2);
  expect(JSON.parse(h.errors.at(-1)!).error.message).toContain('Duplicate option: --json');
  expect(
    await runCli(
      [
        '--server',
        h.env.WORK_SERVER,
        'tasks',
        'update',
        taskId,
        '--json',
        '{"title":"new","expectedVersion":2}',
        '--dry-run',
      ],
      h.io,
      {},
      h.fetcher,
    ),
  ).toBe(0);
  expect(JSON.parse(h.output.at(-1)!).data.body).toEqual({ title: 'new', expectedVersion: 2 });
  expect(h.fetcher).not.toHaveBeenCalled();
});

test('nonblocking login stores a private pending secret and auth complete resumes without printing it', async () => {
  const h = await harness();
  const env = { WORK_CONFIG_DIR: h.directory, WORK_SERVER: h.env.WORK_SERVER };
  h.fetcher.mockResolvedValueOnce(
    Response.json({
      deviceCode: 'pending-device-secret',
      userCode: 'ABCD-1234-EF56',
      verificationUri: h.env.WORK_SERVER + '/agent-access?code=ABCD-1234-EF56',
      expiresIn: 600,
      interval: 5,
    }),
  );
  expect(await runCli(['auth', 'login', '--no-wait', '--write'], h.io, env, h.fetcher)).toBe(0);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(h.output[0]).data).toMatchObject({
    status: 'pending',
    scopes: ['read', 'write'],
  });
  expect((await readPending(env))?.deviceCode).toBe('pending-device-secret');
  if (process.platform !== 'win32') expect((await stat(pendingFile(env))).mode & 0o777).toBe(0o600);
  h.fetcher.mockResolvedValueOnce(
    Response.json({
      status: 'approved',
      accessToken: 'completed-access-secret',
      expiresAt: new Date(h.io.now() + 60000).toISOString(),
      authorization: { id: taskId, scopes: ['read', 'write'] },
    }),
  );
  expect(
    await runCli(['auth', 'complete'], h.io, { WORK_CONFIG_DIR: h.directory }, h.fetcher),
  ).toBe(0);
  expect(await readPending(env)).toBeUndefined();
  expect((await readCredentials(env))?.accessToken).toBe('completed-access-secret');
  expect(h.output.join('') + h.errors.join('')).not.toContain('pending-device-secret');
  expect(h.output.join('') + h.errors.join('')).not.toContain('completed-access-secret');
});

test('pending auth is origin-bound, retained on network errors and removed on denial or expiry', async () => {
  const h = await harness();
  const pending = {
    server: h.env.WORK_SERVER,
    deviceCode: 'private-device',
    userCode: 'ABCD',
    verificationUri: h.env.WORK_SERVER + '/agent-access',
    expiresAt: new Date(h.io.now() + 60000).toISOString(),
    interval: 5,
    scopes: ['read'],
  };
  const env = { WORK_CONFIG_DIR: h.directory };
  await savePending(env, pending);
  expect(
    await runCli(
      ['auth', 'complete', '--server', 'https://other.example.com'],
      h.io,
      env,
      h.fetcher,
    ),
  ).toBe(3);
  expect(h.fetcher).not.toHaveBeenCalled();
  h.fetcher.mockRejectedValueOnce(new Error('offline'));
  expect(await runCli(['auth', 'complete'], h.io, env, h.fetcher)).toBe(6);
  expect(await readPending(env)).toBeDefined();
  h.fetcher.mockResolvedValueOnce(Response.json({ status: 'denied' }));
  expect(await runCli(['auth', 'complete'], h.io, env, h.fetcher)).toBe(1);
  expect(await readPending(env)).toBeUndefined();
  await savePending(env, { ...pending, expiresAt: new Date(h.io.now() - 1).toISOString() });
  const calls = h.fetcher.mock.calls.length;
  expect(await runCli(['auth', 'complete'], h.io, env, h.fetcher)).toBe(3);
  expect(h.fetcher).toHaveBeenCalledTimes(calls);
  expect(await readPending(env)).toBeUndefined();
});

test('auth check diagnoses missing scopes with recovery hints and a nonzero exit', async () => {
  const h = await harness();
  h.fetcher.mockImplementation(async () =>
    Response.json({ user: { id: taskId }, authorization: { scopes: ['read'] } }),
  );
  expect(await runCli(['auth', 'check', '--scope', 'read'], h.io, h.env, h.fetcher)).toBe(0);
  expect(JSON.parse(h.output[0]).data).toMatchObject({ granted: ['read'], missing: [] });
  expect(await runCli(['auth', 'check', '--scope', 'write'], h.io, h.env, h.fetcher)).toBe(4);
  const failure = JSON.parse(h.errors[0]).error;
  expect(failure.detail.missing).toEqual(['write']);
  expect(failure.detail.recovery[0]).toContain('--write --no-wait');
});

test('tasks +mine uses the current human ID and preserves query filters', async () => {
  const h = await harness();
  h.fetcher.mockResolvedValueOnce(Response.json({ user: { id: taskId } }));
  expect(
    await runCli(
      ['tasks', '+mine', '--state-group', 'started', '--limit', '10'],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(0);
  expect(String(h.fetcher.mock.calls[0][0])).toBe(h.env.WORK_SERVER + '/api/agent/v1/me');
  const query = new URL(String(h.fetcher.mock.calls[1][0])).searchParams;
  expect(query.get('responsibleUserId')).toBe(taskId);
  expect(query.get('stateGroup')).toBe('started');
  expect(query.get('limit')).toBe('10');
});

test('bounded pagination preserves filters and truthful truncation metadata with field projection', async () => {
  const h = await harness();
  h.fetcher
    .mockResolvedValueOnce(
      Response.json({
        items: [{ id: 'a', title: 'A', version: 1, description_text: 'large' }],
        nextCursor: 'cursor-a',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: 'b', title: 'B', version: 2 }], nextCursor: 'cursor-b' }),
    );
  expect(
    await runCli(
      [
        'tasks',
        'list',
        '--q',
        'same',
        '--page-all',
        '--page-limit',
        '2',
        '--fields',
        'id,title,version',
      ],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(0);
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  const second = new URL(String(h.fetcher.mock.calls[1][0])).searchParams;
  expect(second.get('q')).toBe('same');
  expect(second.get('cursor')).toBe('cursor-a');
  const data = JSON.parse(h.output[0]).data;
  expect(data.items).toEqual([
    { id: 'a', title: 'A', version: 1 },
    { id: 'b', title: 'B', version: 2 },
  ]);
  expect(data.nextCursor).toBe('cursor-b');
  expect(data.pagination).toEqual({
    pagesFetched: 2,
    itemsReturned: 2,
    truncated: true,
    reason: 'page-limit',
  });
});

test('pagination stops repeated cursors, and NDJSON emits page, row, and final summary', async () => {
  const h = await harness();
  h.fetcher
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: 'a', title: 'A', version: 1 }], nextCursor: 'same' }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: 'b', title: 'B', version: 2 }], nextCursor: 'same' }),
    );
  expect(
    await runCli(
      ['tasks', 'list', '--page-all', '--format', 'ndjson', '--fields', 'id'],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(0);
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  const records = h.output.map((value) => JSON.parse(value));
  expect(records.map((record) => record.type)).toEqual(['page', 'row', 'page', 'row', 'summary']);
  expect(records[1].data).toEqual({ id: 'a' });
  expect(records.at(-1).pagination).toMatchObject({ truncated: true, reason: 'repeated-cursor' });
});

test('an error after streamed pages returns nonzero with partial coverage and no false final summary', async () => {
  const h = await harness();
  h.fetcher
    .mockResolvedValueOnce(Response.json({ items: [{ id: 'a' }], nextCursor: 'next' }))
    .mockRejectedValueOnce(new Error('offline'));
  expect(
    await runCli(['tasks', 'list', '--page-all', '--format', 'ndjson'], h.io, h.env, h.fetcher),
  ).toBe(6);
  expect(h.output.map((value) => JSON.parse(value).type)).toEqual(['page', 'row']);
  expect(JSON.parse(h.errors[0]).error.detail.partial).toEqual({
    pagesFetched: 1,
    itemsFetched: 1,
    emittedRows: 1,
    nextCursor: 'next',
  });
});

test('read projections reject prototype names and expressions, and writes reject presentation flags', async () => {
  const h = await harness();
  for (const fields of ['__proto__', 'constructor', 'id,__proto__', 'title.toString', 'id,id'])
    expect(await runCli(['tasks', 'list', '--fields', fields], h.io, h.env, h.fetcher)).toBe(2);
  expect(await runCli(['tasks', 'list', '--page-limit', '2'], h.io, h.env, h.fetcher)).toBe(2);
  expect(
    await runCli(['tasks', 'list', '--page-all', '--page-limit', '101'], h.io, h.env, h.fetcher),
  ).toBe(2);
  expect(
    await runCli(
      [
        'tasks',
        'update',
        taskId,
        '--json',
        '{"title":"x","expectedVersion":1}',
        '--format',
        'table',
      ],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(2);
  expect(h.fetcher).not.toHaveBeenCalled();
  h.fetcher.mockResolvedValueOnce(
    Response.json({ id: taskId, title: 'line\n\u001b[31mvalue', version: 1 }),
  );
  expect(
    await runCli(
      ['tasks', 'get', taskId, '--format', 'table', '--fields', 'title,version'],
      h.io,
      h.env,
      h.fetcher,
    ),
  ).toBe(0);
  expect(h.output[0]).toBe('title | version\n--- | ---\n');
  expect(h.output.join('')).not.toContain('\u001b');
});

test('the client rejects a server page larger than the requested bound before emitting rows', async () => {
  const h = await harness();
  h.fetcher.mockResolvedValueOnce(
    Response.json({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: null }),
  );
  expect(
    await runCli(['tasks', 'list', '--limit', '1', '--format', 'ndjson'], h.io, h.env, h.fetcher),
  ).toBe(6);
  expect(h.output).toEqual([]);
  expect(JSON.parse(h.errors[0]).error.code).toBe('INVALID_RESPONSE');
});
