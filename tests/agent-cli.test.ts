import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliIO } from '../packages/cli/src/cli';
import { normalizeServer, readCredentials, saveCredentials } from '../packages/cli/src/config';

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
