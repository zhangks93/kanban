import { spawn } from 'node:child_process';
import '../apps/api/src/lib/env';
const child = spawn(process.execPath, ['apps/api/dist/index.mjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    APP_BASE_URL: 'https://work.example.test',
    FEISHU_BASE_URL: '',
    API_PORT: '3002',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr?.on('data', (d) => (stderr += String(d)));
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://localhost:3002/api/health');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error(`Production API failed: ${stderr}`);
  const response = await fetch('http://localhost:3002/api/me');
  if (response.status !== 401) throw Error('Production auth smoke failed');
  console.log('Production bundle boots; DB health and authentication smoke passed');
} finally {
  child.kill('SIGTERM');
}
