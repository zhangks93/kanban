import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { parse } from 'dotenv';
import pg from 'pg';
import { prepareLocalEnv } from '../scripts/local-env';
import { validateEnvironment } from '../apps/api/src/lib/env';
import { getDatabasePoolConfig, getDatabaseUrl } from '../apps/api/src/lib/database-config';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'work-dev-config-'));
  directories.push(root);
  await writeFile(
    resolve(root, '.env.example'),
    'DATABASE_URL=\nFEISHU_APP_ID=\nFEISHU_APP_SECRET=\nAPP_SESSION_SECRET=\n',
  );
  return root;
}
const valid = () => ({
  SUPABASE_DB_URL: 'postgresql://postgres:password@db.example.test:5432/postgres',
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'test-secret',
  APP_SESSION_SECRET: 'test-only-session-secret-longer-than-32-characters',
});

test('local setup creates a private random secret and keeps it across repeated setup', async () => {
  const root = await fixture();
  expect((await prepareLocalEnv(root, {})).created).toBe(true);
  const first = await readFile(resolve(root, '.env'), 'utf8');
  expect(parse(first).APP_SESSION_SECRET).toMatch(/^[a-f0-9]{64}$/);
  expect((await prepareLocalEnv(root, {})).created).toBe(false);
  expect(await readFile(resolve(root, '.env'), 'utf8')).toBe(first);
  const other = await fixture();
  await prepareLocalEnv(other, {});
  expect(parse(await readFile(resolve(other, '.env'), 'utf8')).APP_SESSION_SECRET).not.toBe(
    parse(first).APP_SESSION_SECRET,
  );
});
test('setup fills only an empty secret and preserves custom configuration and ENV_FILE', async () => {
  const root = await fixture();
  const path = resolve(root, '.env.custom');
  const original = 'FEISHU_APP_SECRET="keep # this"\nAPI_PORT=3101\nAPP_SESSION_SECRET=\n';
  await writeFile(path, original);
  await prepareLocalEnv(root, { ENV_FILE: '.env.custom' });
  const content = await readFile(path, 'utf8');
  expect(content.startsWith(original)).toBe(true);
  expect(parse(content)).toMatchObject({ FEISHU_APP_SECRET: 'keep # this', API_PORT: '3101' });
  expect(parse(content).APP_SESSION_SECRET).toHaveLength(64);
  await expect(readFile(resolve(root, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('setup preserves a provided secret and refuses to edit production configuration', async () => {
  const root = await fixture();
  const path = resolve(root, '.env');
  const content = 'NODE_ENV=production\nAPP_SESSION_SECRET=\n';
  await writeFile(path, content);
  await expect(prepareLocalEnv(root, {})).rejects.toThrow('仅用于本地开发');
  expect(await readFile(path, 'utf8')).toBe(content);
  await writeFile(path, 'APP_SESSION_SECRET=my-existing-secret\n');
  await prepareLocalEnv(root, {});
  expect(await readFile(path, 'utf8')).toBe('APP_SESSION_SECRET=my-existing-secret\n');
});
test('missing service configuration reports all missing names without leaking values', () => {
  expect(() => validateEnvironment({ APP_SESSION_SECRET: valid().APP_SESSION_SECRET })).toThrow(
    /DATABASE_URL[\s\S]*FEISHU_APP_ID[\s\S]*FEISHU_APP_SECRET/,
  );
  expect(() =>
    validateEnvironment({ ...valid(), SUPABASE_DB_URL: 'https://secret:password@db.example.test' }),
  ).toThrow('有效的 PostgreSQL');
});
test('CloudBase database URL takes precedence and blank values allow legacy rollback', () => {
  const legacy = valid().SUPABASE_DB_URL;
  const target = 'postgresql://work:encoded%23password@cloudbase.example.test:5432/work';
  expect(getDatabaseUrl({ DATABASE_URL: ` ${target} `, SUPABASE_DB_URL: legacy })).toBe(target);
  expect(getDatabaseUrl({ DATABASE_URL: '  ', SUPABASE_DB_URL: ` ${legacy} ` })).toBe(legacy);
  expect(() => validateEnvironment({ ...valid(), DATABASE_URL: target })).not.toThrow();
  expect(() =>
    getDatabaseUrl({ DATABASE_URL: 'https://private-password@invalid', SUPABASE_DB_URL: legacy }),
  ).toThrow('有效的 PostgreSQL');
  expect(() => getDatabaseUrl({ DATABASE_URL: 'https://private-password@invalid' })).not.toThrow(
    'private-password',
  );
});
test('explicit CA reaches the pg driver with certificate verification despite URL SSL flags', async () => {
  const root = await fixture();
  const path = resolve(root, 'database CA #1.pem');
  const ca = 'test-only-ca-file-content';
  await writeFile(path, ca);
  const config = getDatabasePoolConfig({
    DATABASE_URL:
      'postgres://work:private-password@db.example.test/work?sslmode=no-verify&ssl=false',
    DATABASE_CA_CERT_FILE: path,
  });
  // Inspect the driver's effective TLS options without connecting to a database.
  const client = new pg.Client(config);
  const parameters = Reflect.get(client, 'connectionParameters') as {
    ssl: { ca: string; rejectUnauthorized?: boolean };
  };
  expect(parameters.ssl.ca).toBe(ca);
  expect(parameters.ssl.rejectUnauthorized).not.toBe(false);
});
test('URL SSL configuration is retained when no custom CA is provided; CA errors redact values', () => {
  const target = 'postgres://work:private-password@db.example.test/work?sslmode=verify-full';
  expect(getDatabasePoolConfig({ DATABASE_URL: target }).connectionString).toBe(target);
  const env = {
    ...valid(),
    DATABASE_URL: target,
    DATABASE_CA_CERT_FILE: '/missing/private-path/ca.pem',
  };
  expect(() => validateEnvironment(env)).toThrow('DATABASE_CA_CERT_FILE');
  expect(() => validateEnvironment(env)).not.toThrow('private-path');
  expect(() => validateEnvironment(env)).not.toThrow('private-password');
});
test('session pooler works but transaction pooler is rejected before migrations', () => {
  expect(() =>
    validateEnvironment({
      ...valid(),
      SUPABASE_DB_URL: 'postgres://postgres:secret@aws-0.pooler.supabase.com:5432/postgres',
    }),
  ).not.toThrow();
  expect(() =>
    validateEnvironment({
      ...valid(),
      SUPABASE_DB_URL: 'postgres://postgres:secret@aws-0.pooler.supabase.com:6543/postgres',
    }),
  ).toThrow('Session pooler');
});
test('defaults and custom development ports work; invalid origin, ports and short secrets fail', () => {
  expect(() => validateEnvironment(valid())).not.toThrow();
  expect(() =>
    validateEnvironment({ ...valid(), APP_BASE_URL: 'http://localhost:5180', API_PORT: '3101' }),
  ).not.toThrow();
  expect(() =>
    validateEnvironment({ ...valid(), APP_BASE_URL: 'http://localhost:5173/my' }),
  ).toThrow('origin');
  expect(() => validateEnvironment({ ...valid(), API_PORT: 'abc' })).toThrow('API_PORT');
  expect(() => validateEnvironment({ ...valid(), APP_SESSION_SECRET: 'short' })).toThrow('32');
});
test('production requires HTTPS and a configured secret and rejects Fake Feishu', () => {
  const env = { ...valid(), NODE_ENV: 'production', APP_BASE_URL: 'https://work.example.test' };
  expect(() => validateEnvironment(env)).not.toThrow();
  expect(() => validateEnvironment({ ...env, FEISHU_BASE_URL: 'http://localhost:4001' })).toThrow(
    '禁止',
  );
  expect(() => validateEnvironment({ ...env, APP_BASE_URL: 'http://localhost:5173' })).toThrow(
    'HTTPS',
  );
  expect(() => validateEnvironment({ ...env, APP_SESSION_SECRET: '' })).toThrow(
    'APP_SESSION_SECRET',
  );
});

test('reset and seed refuse remote databases before opening a connection', () => {
  for (const mode of ['reset', 'seed']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/db.ts', mode], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://postgres:private-password@db.example.test/postgres',
        SUPABASE_DB_URL: '',
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Reset/seed only supports local disposable databases');
    expect(result.stderr).not.toContain('private-password');
  }
});
