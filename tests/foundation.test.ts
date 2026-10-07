import { test, expect, afterAll } from 'vitest';
import { buildApp } from '../apps/api/src/app';
import { pool } from '../apps/api/src/lib/db';
afterAll(() => pool.end());
test('API -> PostgreSQL smoke, request id', async () => {
  const app = await buildApp();
  const res = await app.inject('/api/health');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  expect(res.headers['x-request-id']).toBeTruthy();
  await app.close();
});
