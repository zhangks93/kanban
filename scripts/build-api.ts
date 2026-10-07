import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = existsSync('pnpm-workspace.yaml') ? process.cwd() : resolve(process.cwd(), '../..');
await build({
  absWorkingDir: root,
  entryPoints: ['apps/api/src/index.ts'],
  outfile: 'apps/api/dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['fastify', '@fastify/*', 'pg', '@sentry/node', 'dotenv', 'zod'],
});
console.log('API production bundle built');
