import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pool, transaction } from '../apps/api/src/lib/db';
import { buildApp } from '../apps/api/src/app';
import { coreTemplates } from '../packages/plugin-sdk/src';
import { hash, random, signed } from '../apps/api/src/middleware/auth';
const actor = '10000000-0000-4000-8000-000000000002';
const worker = '10000000-0000-4000-8000-000000000003';
const wid = '20000000-0000-4000-8000-000000000001';
let board: any;
const app = await buildApp();
try {
  board = await transaction(actor, async (db) => {
    const b = (
      await db.query('SELECT * FROM create_board($1,$2,$3,$4,$5)', [
        wid,
        `PERF${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        '1000 卡片性能测试',
        'workspace',
        coreTemplates[0],
      ])
    ).rows[0];
    for (let i = 0; i < 1000; i++)
      await db.query('SELECT create_task($1,$2)', [
        b.id,
        { title: `性能测试任务 ${i + 1}`, responsibleUserId: worker },
      ]);
    return b;
  });
  const token = random();
  await pool.query(
    "INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(token), actor],
  );
  const cookie = `session=${signed(token)}`;
  const readStart = performance.now();
  const tasks = await app.inject({ url: `/api/boards/${board.id}/tasks`, headers: { cookie } });
  const readMs = performance.now() - readStart;
  if (tasks.statusCode !== 200 || tasks.json().length !== 1000)
    throw Error('1000-card API check failed');
  let t = tasks.json()[0];
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    const result = await app.inject({
      url: `/api/tasks/${t.id}`,
      method: 'PATCH',
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: { expectedVersion: t.version, title: `性能样本 ${i}` },
    });
    if (result.statusCode !== 200) throw Error('mutation failed');
    samples.push(performance.now() - start);
    t = result.json();
  }
  samples.sort((a, b) => a - b);
  const report = {
    date: new Date().toISOString(),
    cards: 1000,
    boardReadMs: Math.round(readMs * 100) / 100,
    mutationSamples: samples.length,
    mutationP50Ms: Math.round(samples[24] * 100) / 100,
    mutationP95Ms: Math.round(samples[47] * 100) / 100,
    environment:
      'Local PostgreSQL 15, Fastify inject (no external network), Node 24; indicative only',
  };
  await writeFile('docs/performance.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (board)
    await transaction(actor, (db) =>
      db.query("UPDATE board SET status='archived' WHERE id=$1", [board.id]),
    );
  await app.close();
  await pool.end();
}
