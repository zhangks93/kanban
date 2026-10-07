# Work · 内部工作管理平台

根据 `work-platform-codex-spec-v1.3-final-cn.md` 实现的 pnpm monorepo。产品界面与运行说明使用简体中文。

## 本地启动

需要 Node.js 22.13+ 或 24、pnpm 11.19.0、Docker Compose。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --build --wait
pnpm db:reset
```

分别打开两个终端：

```bash
pnpm fake:feishu
```

```bash
pnpm dev
```

访问 **http://localhost:5173**，选择“使用飞书登录”。本地 Fake Feishu 可选择平台管理员、user_a、user_b、user_c、user_d 或首次登录用户。

`db:reset` 会重建本地 `public` schema；脚本拒绝远程地址。E2E 的 global setup 同样重置本地测试数据库。勿指向需要保留数据的本地数据库。

## 已实现

- 飞书 OAuth state 防重放、HttpOnly 签名 Session、每次请求重新检查账号状态、mutation Origin 校验。
- 多 Workspace、Owner/Admin/Member、平台用户状态与 WIP 上限管理、最后一位有效 Owner 的数据库保护。
- Workspace / restricted Board、Lead/Member/Viewer、成员显式撤销、权限谓词与 Worker 资格分离。
- 状态、持久泳道、任务类型、里程碑、标签、Parent 三层树、评论、资源、活动与审计。
- 单一负责人、多个参与人、参与人转负责人、原子 State/Lane/Responsible 移动、Task version、软删除、创建幂等。
- 个人跨 Workspace 全局 WIP；多人同时 Focus；Unfocus；超限时仍允许一换一 Replace；非法 Focus 同事务清理。
- 静态 manifest/server/web 插件装配、按 Workspace 启停、依赖保护；研发 System/Module/项目泳道和运维 Service/Severity/事件属性。
- My Work、Board、Peek 与完整详情、动态 Grouping、Participants Filter、串行变更队列、搜索、通知、Intake、管理界面。
- 低装饰高密度工作台、手机布局、Dialog/Popover 焦点管理、8 张截图基线、1,000 卡片虚拟化。

## 仓库

```text
apps/api        Fastify API / Session / PostgreSQL repositories / composition root
apps/web        React 19 + Vite / TanStack Router & Query / workbench
packages/shared 错误码、schema、共享类型
packages/plugin-sdk  插件接口与 Core 模板，不依赖具体插件
packages/plugin-rnd  研发插件三个入口
packages/plugin-ops  运维插件三个入口
supabase/migrations  M0–M6 SQL migrations
supabase/tests       pgTAP
supabase/seed.sql     双 Workspace、多 Worker、跨空间 WIP 演示数据
tests                API、并发、队列与 Playwright
scripts              migration、seed、构建、secret scan、性能采样
docs                 实施决策、验证记录、部署与视觉检查
```

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test:db
pnpm test
pnpm build
pnpm check:secrets
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm benchmark
```

已有 Chromium 的环境可用 `CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e`。截图基线在 Linux Chromium 下生成；首次更换 OS、字体或浏览器版本时应人工复核差异，确认后执行 `pnpm test:e2e --update-snapshots`。不能将功能失败通过更新截图掩盖。

本次验证结果见 `docs/verification.md`。GitHub Actions 工作流已提供，尚未在远端触发。

## 正式飞书与 Supabase

真实飞书、Supabase 和 Sentry 均从 API 环境变量读取配置。移除 `FEISHU_BASE_URL`，设置真实 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，在飞书配置 `${APP_BASE_URL}/auth/feishu/callback`，并设置稳定 open_id 对应的平台管理员标识。生产环境拒绝 Fake Feishu override。

运行 `pnpm db:migrate` 应用迁移；生产环境不运行演示 seed。Web 构建后由同源 HTTPS 反向代理提供静态文件，将 `/api` 与 `/auth` 代理到 API。运行：

```bash
pnpm build
NODE_ENV=production node apps/api/dist/index.mjs
```

数据库连接仅由 API 使用。详细配置、权限和 TLS 说明见 `docs/deployment.md`。

**真实飞书应用与 Hosted Supabase 联调尚未执行**：当前环境没有相关凭据，登录验证采用独立 Fake Feishu 与真实本地 PostgreSQL。代码中的正式流程已实现，部署前需要用目标租户配置验证回调与数据库连接。
