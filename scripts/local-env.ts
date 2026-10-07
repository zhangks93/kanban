import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

// Only development setup writes configuration. API/production startup never generates secrets.
export async function prepareLocalEnv(root: string, env: NodeJS.ProcessEnv = process.env) {
  const path = resolve(root, env.ENV_FILE ?? '.env');
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    content = await readFile(resolve(root, '.env.example'), 'utf8');
    if (env.NODE_ENV === 'production' || parse(content).NODE_ENV === 'production')
      throw Error('pnpm setup / pnpm dev 仅用于本地开发；生产环境请显式配置密钥并运行 pnpm build');
    content = content.replace(
      /^APP_SESSION_SECRET=.*$/m,
      `APP_SESSION_SECRET=${randomBytes(32).toString('hex')}`,
    );
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    return { path, created: true };
  }
  const values = parse(content);
  if ((env.NODE_ENV || values.NODE_ENV) === 'production')
    throw Error('pnpm setup / pnpm dev 仅用于本地开发；生产环境请显式配置密钥并运行 pnpm build');
  if (!env.APP_SESSION_SECRET && !values.APP_SESSION_SECRET?.trim()) {
    await writeFile(
      path,
      `${content.trimEnd()}\nAPP_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`,
      { mode: 0o600 },
    );
  }
  return { path, created: false };
}
