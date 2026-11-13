# 部署

默认使用飞书 OAuth / Session 与 CloudBase HTTPS RPC。用户、角色和业务数据保存在 CloudBase，按 [CloudBase 接入指南](cloudbase-sdk.md) 初始化；部署仍需 API 与 Web，沿用下面的同源反向代理。以下 TCP 数据库要求仅适用于兼容模式。

本地调试按 [README 快速开始](../README.md#快速开始) 执行 `pnpm setup` → 填写飞书与 CloudBase 配置 → `pnpm dev`。本文件说明生产部署要求。

## 服务边界

Web 只请求同源 `/api` 和 `/auth`。API 使用服务端数据库账号，通过 `pg` TCP 连接 CloudBase 国内站独享 PostgreSQL。飞书 OAuth 与应用 Session 保持不变，数据库不向浏览器开放。

构建：`pnpm install --frozen-lockfile && pnpm build`。Web 产物在 `apps/web/dist/`；API 产物是 `apps/api/dist/index.mjs`。API package 的 `start` 脚本也可启动 bundle。

API 需要 `APP_BASE_URL`、至少 32 个随机字符的 `APP_SESSION_SECRET`、`DATABASE_URL`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`，以及首次引导需要的 `BOOTSTRAP_PLATFORM_ADMIN_FEISHU_ID`。`API_PORT` 默认 3001；`SENTRY_DSN` 可选。CloudBase HTTPS 模式改用环境 ID 与 Publishable Key；`VITE_CLOUDBASE_*` 由 API 读取，也支持不带 VITE_ 的服务端名称。飞书和 Session 密钥始终留在服务端。

使用飞书应用的稳定 **open_id** 建立用户唯一索引。管理员引导变量也使用 open_id；已存在的目标用户会在下一次登录时被引导为管理员。普通登录或移除引导变量不会降权已有管理员。

生产中取消 `FEISHU_BASE_URL`，设置 `NODE_ENV=production`。Cookie 将启用 Secure、HttpOnly、SameSite=Lax。配置同源 HTTPS；Mutation Origin 必须与 `APP_BASE_URL` 的 origin 完全一致。

公开看板使用 `/share/:token`，无需飞书登录；只有有效分享凭证可读取任务摘要，修改任务仍要求内部登录和权限。需求与工单提报进入内部待受理列表，联系人信息不出现在公开接口中。迁移会将旧研发系统与运维服务迁入共享系统；旧研发模块及任务关联保留，不会被当成项目。已有泳道的项目编号、负责人和日期保持原样，可在基础数据中新建项目，再在任务或泳道设置中关联。

公开提报按看板和访客 IP 限制为每 10 分钟 10 次。若通过反向代理部署，设置 `TRUSTED_PROXY_CIDRS` 为实际代理来源 IP/CIDR（本机 Nginx 如 `127.0.0.1/32,::1/128`），并由代理覆盖 `X-Forwarded-For`，以便正确区分访客。不要把不受信任的来源加入该配置。未配置时忽略转发头，按直接连接地址计数。

## 数据库

迁移已有 Supabase 数据前执行 [CloudBase 迁移指南](cloudbase-migration.md)。仅修改连接串不会迁移已有数据；尚未完成目标环境、实例和网络验证时，不应把配置改动视作已完成线上切换。

本项目依赖 PostgreSQL 15+、`pgcrypto`、`pg_trgm`、PL/pgSQL、事务与会话级 advisory lock。先核查目标实例实际版本、扩展可用性和账号权限。CloudBase **共享 PostgreSQL 不提供 TCP 端点**；这套 `pg.Pool` 访问方式要求独享实例。不得在未确认费用和目标规格时自动创建或升级资源。

API 应运行在数据库同地域、同 VPC 的计算环境，使用控制台实际提供的私网主机及端口，并设置相应安全组。VPC / 子网信息从数据库详情读取；本地机器需要已配置的 VPN 或其他可靠私网接入。EnvId 不是数据库地址，也不代表数据库已经具备公网连通性。

把连接串保存在服务端 `DATABASE_URL`，按控制台要求启用 TLS 并验证服务器证书。自定义 CA 可挂载到安全路径并通过 `DATABASE_CA_CERT_FILE` 指定。不要关闭证书验证。`SUPABASE_DB_URL` 仅在 `DATABASE_URL` 为空时作为兼容值；回滚时必须更新或清除 `DATABASE_URL`，仅改旧变量不会改变目标库。

备份并确认目标数据库后，先运行只读预检 `pnpm db:check`，再运行 `pnpm db:migrate`。预检不代替管理面核查目标完整 EnvId 和实例规格。迁移账号需要创建业务表、函数和扩展的权限；API 私有账号只授予所需表 DML、sequence usage 和业务函数 EXECUTE。业务数据授权仍由 API / SQL transaction functions 实施；不要给 CloudBase 网关角色 `anon`、`authenticated`、`service_role` 授予业务表及函数访问，迁移后检查并撤销意外授权。若用独立迁移账号，完整授权 API 账号后再部署。

`supabase/migrations/` 保留历史目录名，内容是通用 PostgreSQL SQL；`public.schema_migrations` 记录已应用文件，迁移历史和业务数据一起迁入目标库。每个 SQL 文件在一个事务中执行，迁移过程使用会话级 advisory lock。直连或保持会话语义的连接池可用；旧 Supabase Transaction pooler（6543）不支持这套迁移方式。API 使用 `search_path=public,extensions`，兼容历史扩展安装位置；连接池默认最大 20 个连接，应结合目标实例容量与 API 副本数量安排连接预算。

`pnpm dev` 在启动前自动执行待应用迁移，不执行 reset 或 seed。`db:reset` / `db:seed` 仅接受回环地址，用于可重建的测试数据，不能用于 CloudBase 等远端数据库。

## HTTPS 反向代理示例

```nginx
server {
  listen 443 ssl;
  server_name work.example.com;
  # ssl_certificate / ssl_certificate_key 由部署环境管理
  root /srv/work/apps/web/dist;
  location /api/ {
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass http://127.0.0.1:3001;
  }
  location /auth/ { proxy_pass http://127.0.0.1:3001; }
  location / { try_files $uri $uri/ /index.html; }
}
```

API 进程由 systemd 或其他进程管理器托管。配置统一从仓库根目录 `.env` 或进程环境变量读取；相对 `ENV_FILE` 以仓库根目录解析。Web 构建仅使用 `VITE_` 前缀的公开配置。不要将 `.env`、源码 maps 或数据库配置放进静态站点目录。数据库写入都由 `apps/api` 或其授权 migration/test scripts 执行。

生产启动使用 `NODE_ENV=production node apps/api/dist/index.mjs`。生产必须显式提供随机 Session 密钥，不自动生成；`pnpm setup` 与 `pnpm dev` 会拒绝生产配置。

## 外部联调

真实 Feishu 应用、目标 CloudBase 国内站数据库、Sentry、反向代理与远端 CI 需要在目标环境单独联调。需要在目标环境验证 OAuth 回调白名单、open_id 管理员引导、数据库 TLS/角色授权、日志与监控。
