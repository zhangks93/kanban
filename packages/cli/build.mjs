import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
const skills = {};
for (const name of ['work-platform', 'work-shared', 'work-tasks', 'work-workflow-triage'])
  skills[name] = await readFile(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/work.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  define: { __WORK_SKILLS__: JSON.stringify(skills) },
});
await chmod('dist/work.mjs', 0o755);
