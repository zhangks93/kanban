import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';
import { prepareLocalEnv } from './local-env';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
try {
  const result = await prepareLocalEnv(root);
  if (result.created) console.log('已创建 .env，请填写 Supabase 与飞书配置后重新运行 pnpm dev。');
  const { validateEnvironment } = await import('../apps/api/src/lib/env');
  validateEnvironment();
  if (!process.env.BOOTSTRAP_PLATFORM_ADMIN_FEISHU_ID)
    console.warn(
      '提示：首次使用请配置 BOOTSTRAP_PLATFORM_ADMIN_FEISHU_ID，管理员才能创建工作空间。',
    );
  const { pool } = await import('../apps/api/src/lib/db');
  try {
    const { migrate } = await import('./migrations');
    console.log('正在检查数据库并应用待执行的迁移…');
    await migrate(pool);
  } finally {
    await pool.end();
  }
  console.log(`\n本地工作台：${process.env.APP_BASE_URL}`);
  console.log(
    `飞书回调地址：${new URL('/auth/feishu/callback', process.env.APP_BASE_URL).toString()}\n`,
  );
  const { result: running } = concurrently(
    [
      { command: 'pnpm --filter @work/api dev', name: 'api', prefixColor: 'blue' },
      { command: 'pnpm --filter @work/web dev', name: 'web', prefixColor: 'green' },
    ],
    { cwd: root, killOthersOn: ['failure', 'success'] },
  );
  await running;
} catch (error) {
  if (Array.isArray(error)) {
    process.exitCode = error.every((event) => event.killed || event.exitCode === 'SIGINT') ? 0 : 1;
  } else {
    console.error(
      error instanceof Error ? error.message : '本地启动失败，请检查配置与数据库连接。',
    );
    process.exitCode = 1;
  }
}
