import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { getDatabasePoolConfig } from './database-config';

export function loadEnvironment() {
  let root = process.cwd();
  while (!existsSync(resolve(root, 'pnpm-workspace.yaml')) && dirname(root) !== root)
    root = dirname(root);
  if (!existsSync(resolve(root, 'pnpm-workspace.yaml'))) root = process.cwd();
  const path = process.env.ENV_FILE ? resolve(root, process.env.ENV_FILE) : resolve(root, '.env');
  config({ quiet: true, path });
  process.env.NODE_ENV ||= 'development';
  process.env.APP_BASE_URL ||= 'http://localhost:5173';
  process.env.API_PORT ||= '3001';
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const errors: string[] = [];
  try {
    getDatabasePoolConfig(env);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : '数据库配置无效');
  }
  for (const key of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']) {
    if (!env[key]?.trim()) errors.push(`请配置 ${key}`);
  }
  if (!env.APP_SESSION_SECRET || env.APP_SESSION_SECRET.length < 32)
    errors.push('APP_SESSION_SECRET 至少需要 32 个字符；本地开发可运行 pnpm setup 自动生成');
  try {
    const url = new URL(env.APP_BASE_URL ?? 'http://localhost:5173');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw Error();
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:')
      errors.push('生产环境 APP_BASE_URL 必须使用 HTTPS');
  } catch {
    errors.push('APP_BASE_URL 必须是 HTTP(S) origin，例如 http://localhost:5173');
  }
  const port = Number(env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.push('API_PORT 必须是 1–65535 之间的整数');
  if (env.NODE_ENV === 'production' && env.FEISHU_BASE_URL)
    errors.push('生产环境禁止配置 FEISHU_BASE_URL');
  if (errors.length) throw Error(`环境配置检查失败：\n- ${errors.join('\n- ')}`);
}

loadEnvironment();
