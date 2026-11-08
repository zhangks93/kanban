import '../apps/api/src/lib/env';
import pg from 'pg';
import { getDatabasePoolConfig } from '../apps/api/src/lib/database-config';

// Read-only preflight: never install extensions, apply migrations or change roles.
let pool: pg.Pool | undefined;
try {
  pool = new pg.Pool(getDatabasePoolConfig());
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const {
      rows: [server],
    } = await db.query<{
      version: number;
      can_create: boolean;
      plpgsql: boolean;
      tls: boolean;
    }>(`SELECT current_setting('server_version_num')::int AS version,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
      EXISTS (SELECT 1 FROM pg_language WHERE lanname = 'plpgsql') AS plpgsql,
      COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls`);
    if (server.version < 150000) throw Error('需要 PostgreSQL 15 或更新版本');
    if (!server.plpgsql) throw Error('目标数据库需要 PL/pgSQL');
    const { rows: extensions } = await db.query<{ name: string; installed: boolean }>(
      `SELECT name, installed_version IS NOT NULL AS installed
       FROM pg_available_extensions WHERE name IN ('pgcrypto', 'pg_trgm') ORDER BY name`,
    );
    if (extensions.length !== 2) throw Error('目标数据库必须支持 pgcrypto 和 pg_trgm 扩展');
    const {
      rows: [history],
    } = await db.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    let applied = 0;
    if (history.exists) {
      const {
        rows: [count],
      } = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.schema_migrations',
      );
      applied = count.count;
    }
    console.log(`PostgreSQL ${Math.floor(server.version / 10000)}；PL/pgSQL 可用`);
    console.log(`传输：${server.tls ? 'TLS' : '未使用 TLS（请核对实例的私网连接要求）'}`);
    console.log(
      `扩展：${extensions.map((e) => `${e.name} ${e.installed ? '已安装' : '可用，迁移账号需有安装权限'}`).join('；')}`,
    );
    console.log(
      `迁移历史：${history.exists ? `${applied} 个已应用文件` : '尚无 schema_migrations 表'}`,
    );
    console.log(
      `public 建对象权限：${server.can_create ? '有' : '无（运行 db:migrate 需要独立迁移账号）'}`,
    );
    console.log('只读检查通过；尚未写入、迁移或切换数据库。');
    await db.query('ROLLBACK');
  } finally {
    db.release();
  }
} catch (error) {
  // Do not echo driver messages: a malformed URL or filesystem error may include credentials.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const safeCode = /^[A-Z0-9_]{2,40}$/.test(code) ? `（${code}）` : '';
  console.error(
    `数据库预检失败${safeCode}。请检查 DATABASE_URL、CA、网络以及 PostgreSQL 版本、扩展和迁移权限。`,
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
