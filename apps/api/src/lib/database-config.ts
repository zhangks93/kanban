import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolConfig } from 'pg';

// Keep runtime, migrations and development checks on the same selected database.
export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim() || env.SUPABASE_DB_URL?.trim();
  if (!value) throw Error('请配置 DATABASE_URL（PostgreSQL 连接串；兼容原 SUPABASE_DB_URL）');
  let url: URL;
  try {
    url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw Error();
  } catch {
    throw Error('DATABASE_URL 必须是有效的 PostgreSQL 连接串');
  }
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543')
    throw Error('DATABASE_URL 请使用 Direct connection 或 Session pooler（5432），以支持迁移');
  return value;
}

export function getDatabasePoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  let connectionString = getDatabaseUrl(env);
  const caFile = env.DATABASE_CA_CERT_FILE?.trim();
  if (caFile) {
    const path = resolve(caFile);
    try {
      readFileSync(path, 'utf8');
    } catch {
      // File errors may contain paths supplied in configuration; report only the setting name.
      throw Error('无法读取 DATABASE_CA_CERT_FILE，请检查 CA 证书文件和权限');
    }
    // pg parses SSL URL parameters after PoolConfig.ssl. Keep the CA in the URL itself
    // so sslmode in a supplied connection string cannot discard certificate verification.
    const url = new URL(connectionString);
    url.searchParams.set('sslrootcert', path);
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.delete('ssl');
    connectionString = url.toString();
  }
  return {
    connectionString,
    options: '-c search_path=public,extensions',
    max: 20,
    connectionTimeoutMillis: 5000,
  };
}
