# 部署

本地调试按 [README 快速开始](../README.md#快速开始) 执行 `pnpm setup` → 填写飞书与 Supabase 配置 → `pnpm dev`。本文件说明生产部署要求。

## 服务边界

Web 只请求同源 `/api` 和 `/auth`。API 使用服务端数据库账号连接 Supabase Hosted PostgreSQL。不要使用 Supabase Auth、PostgREST 或浏览器 service role。

构建：`pnpm install --frozen-lockfile && pnpm build`。Web 产物在 `apps/web/dist/`；API 产物是 `apps/api/dist/index.mjs`。API package 的 `start` 脚本也可启动 bundle。

API 需要 `APP_BASE_URL`、至少 32 个随机字符的 `APP_SESSION_SECRET`、`SUPABASE_DB_URL`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`，以及首次引导需要的 `BOOTSTRAP_PLATFORM_ADMIN_FEISHU_ID`。`API_PORT` 默认 3001；`SENTRY_DSN` 可选。Web 只接受 `VITE_SENTRY_DSN`，其余环境配置不得添加 `VITE_` 前缀。

使用飞书应用的稳定 **open_id** 建立用户唯一索引。管理员引导变量也使用 open_id；已存在的目标用户会在下一次登录时被引导为管理员。普通登录或移除引导变量不会降权已有管理员。

生产中取消 `FEISHU_BASE_URL`，设置 `NODE_ENV=production`。Cookie 将启用 Secure、HttpOnly、SameSite=Lax。配置同源 HTTPS；Mutation Origin 必须与 `APP_BASE_URL` 的 origin 完全一致。

## 数据库

先备份已有生产数据，再运行 `SUPABASE_DB_URL=... pnpm db:migrate`。数据库版本为 PostgreSQL 15+，需要 `pg_trgm`。迁移和平台 API 使用可创建扩展的数据库账号；生产账号权限可以进一步分离，但所有 Core transaction functions、trigger functions、sequences 与所需表的权限必须完整授权给 API 私有账号。

迁移显式撤销 PUBLIC、Supabase anon/authenticated 对业务表与 public functions 的访问。正式部署按需授权 API 私有角色，并设置 `search_path=public,extensions`。如果使用独立 migration 账号，给 API 角色授予业务表 DML、sequence usage 与业务函数 EXECUTE；不要给浏览器角色授权。

连接应使用 Supabase 提供的正式连接地址与受信任 CA，启用完整证书验证；连接串可使用驱动支持的 `sslmode=verify-full`。不要关闭 TLS 验证。当前实现固定使用 `pg` connection pool，默认最大 20 个连接。

`schema_migrations` 记录已应用文件。每个 SQL 文件在一个事务中执行，迁移过程使用会话级 advisory lock 避免重复启动时并发执行。使用 Direct connection 或 Session pooler（5432），不使用 Transaction pooler（6543）。API 连接显式设置 `search_path=public,extensions`，兼容 Supabase 将扩展安装在 `extensions` schema 的情况。

`pnpm dev` 在启动前自动执行待应用迁移，不执行 reset 或 seed。`db:reset` / `db:seed` 仅接受回环地址，用于可重建的测试数据，不能用于 Hosted Supabase。

## HTTPS 反向代理示例

```nginx
server {
  listen 443 ssl;
  server_name work.example.com;
  # ssl_certificate / ssl_certificate_key 由部署环境管理
  root /srv/work/apps/web/dist;
  location /api/ { proxy_pass http://127.0.0.1:3001; }
  location /auth/ { proxy_pass http://127.0.0.1:3001; }
  location / { try_files $uri $uri/ /index.html; }
}
```

API 进程由 systemd 或其他进程管理器托管。配置统一从仓库根目录 `.env` 或进程环境变量读取；相对 `ENV_FILE` 以仓库根目录解析。Web 构建仅使用 `VITE_` 前缀的公开配置。不要将 `.env`、源码 maps 或数据库配置放进静态站点目录。数据库写入都由 `apps/api` 或其授权 migration/test scripts 执行。

生产启动使用 `NODE_ENV=production node apps/api/dist/index.mjs`。生产必须显式提供随机 Session 密钥，不自动生成；`pnpm setup` 与 `pnpm dev` 会拒绝生产配置。

## 外部联调

真实 Feishu 应用、Hosted Supabase、Sentry、反向代理与远端 CI 均未在当前环境中连接。需要在目标环境验证 OAuth 回调白名单、open_id 管理员引导、数据库 TLS/角色授权、日志与监控。
