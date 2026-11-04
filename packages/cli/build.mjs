import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/work.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
});
await chmod('dist/work.mjs', 0o755);
