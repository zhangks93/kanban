# Supabase → CloudBase 国内站 PostgreSQL

> 本文保留旧 API / TCP 接入与备份恢复说明。使用 Environment ID + Publishable Key 的完整看板与认证迁移，请按 [CloudBase SDK 接入指南](cloudbase-sdk.md) 操作；该模式不要求 TCP 连接串。

目标环境：`final-pony-d7gnzgdj1b8ab4f99`，地域上海 `ap-shanghai`，国内站。当前仓库已准备数据库配置适配；尚未登录该环境、核查实例规格或迁移远端数据。完整 EnvId 用于管理面选择环境，不能据此拼接 PostgreSQL 主机地址。

应用继续使用服务端 `pg.Pool`、现有 SQL transaction functions、飞书 OAuth 和应用 Session。CloudBase 的浏览器 Auth、PostgREST 与文档数据库不参与这条访问路径。

## 1. 核查目标和连通性

仓库 `.cloudbase/project.json` 已记录国内站、上海地域和目标 EnvId；`.codex/config.toml` 已配置国内远端 MCP 地址。配置文件不代表完成授权。支持项目配置的 Codex 客户端在重新加载项目后，通过 MCP 的 OAuth 登录并选择上述环境，再查询环境详情。当前会话已安装并验证 CloudBase CLI 3.9.1，但设备登录因网络受限未完成；网络放行后也可用 `tcb login --intl false` 继续授权。

1. 在国内站完成授权，查询完整 EnvId 和地域对应的环境详情，确认已经开通 PostgreSQL。
2. 检查 PostgreSQL `TenantType`：本应用的 TCP 驱动要求 **独享实例**。共享实例仅提供 SDK / 网关访问，配置 VPC 不能使其获得 TCP 端点；如果目标为共享实例，需要先决定独享实例方案及费用，或另行设计访问层改造。
3. 从数据库详情取得实际主机、端口、数据库名、账号、VPC / 子网、安全组及 TLS / CA 要求。API 应与数据库同地域、同 VPC；本地连接需要已配置的私网接入。不要仅凭 EnvId 推断网络已通。
4. 确认 PostgreSQL 15+、`pgcrypto`、`pg_trgm`、PL/pgSQL、触发器、事务和会话级 advisory lock 可用。确认迁移账号可创建这些对象，目标连接不是事务级连接池。
5. 在服务端密钥配置中设置 `DATABASE_URL`；自定义 CA 可通过 `DATABASE_CA_CERT_FILE` 指向挂载的 CA 文件。不要在聊天、Git、命令历史或前端构建变量中填写数据库密码。采用控制台提供的可信 CA，启用 TLS 时完整校验服务器证书。

在配置 `DATABASE_URL` 的运行环境先执行只读预检：

```bash
pnpm db:check
```

预检检查数据库版本、扩展、PL/pgSQL、当前角色权限、TLS 实际状态和迁移历史；它不能代替管理面确认国内站、完整 EnvId、共享 / 独享规格或 VPC 归属。

当前执行环境的网络策略会阻止 CloudBase 管理端点，且未配置目标数据库凭据；需要先放通 `tcb-api.cloud.tencent.com` 及实际认证、管理 API / 数据库连接所需的目标，才能完成远端授权和验证。TCP 私网访问与 HTTP 域名放行是不同的配置。

## 2. 备份并冻结旧库写入

先在隔离的预演环境完成全流程，再安排生产切换窗口。记录当前部署版本、旧连接配置、应用 Session 密钥及已应用迁移清单，保留可恢复的旧库和备份。

停掉所有对旧库写入的 API 副本、后台作业和外部客户端，再导出最终快照。源库不应同时接受写入，否则导入期间产生的数据不会自动同步。

使用安全配置的 PostgreSQL service / passfile，避免把密码写进命令行。以下 service 名是本机配置名称，不是 CloudBase EnvId：

```bash
pg_dump --dbname='service=work_source' --format=custom \
  --schema=public --no-owner --no-privileges --file=work-public.dump
pg_restore --list work-public.dump > work-public.contents
```

备份只包含本项目的 `public` 业务对象和数据，必须包含 `public.schema_migrations`，保留迁移文件名和应用记录。不要把 Supabase 的 `auth`、`storage`、`realtime`、`extensions` 等托管系统 schema 或集群角色整库覆盖到 CloudBase。`public.auth_session` 是本应用的业务表，和托管的 `auth` schema 不同，需要随业务数据迁移。

保存加密备份并验证能够恢复。对照导出目录确认业务表、函数、触发器、序列和迁移历史齐全；如果源库含本项目以外的 `public` 对象，先明确保留清单，不能不加检查地一并导入。

## 3. 在空目标库恢复业务对象

在执行前核查目标 `public` 对象清单，确认不会覆盖已有业务。不要使用 `--clean`、`DROP SCHEMA`、`db:reset` 或 `db:seed` 处理 CloudBase 远端数据库。若目标已有同名对象，停止并先制定合并方案。

确认目标已经提供或允许创建 `pgcrypto`、`pg_trgm`，并核查扩展安装的 schema。源库扩展可能位于 `extensions`，目标可能位于 `public`；还原之前检查备份中函数、索引与扩展的限定名称。应先在预演库解决扩展位置、对象依赖及目标权限差异，不能在生产还原报错后忽略错误继续切换。

使用目标迁移账号恢复，禁止恢复源账号所有权和 ACL；这也可避免引用 Supabase 专有角色。确认过备份目录与目标对象后执行：

先复制 `work-public.contents` 为 `work-public.restore.list`，逐项审核。目标已存在 `public` schema，在清单中给 `SCHEMA - public` 以及相应 schema 注释项行首加 `;`，避免重复创建。保留全部业务表、数据、函数、触发器、序列及迁移历史；排除非本项目对象和托管扩展对象。目标所需扩展必须由迁移账号事先安装在正确 schema 中，因为按 schema 导出的备份不会自动包含所有外部依赖。

使用这份清单生成受保护的 SQL 文件，再把恢复和业务撤权放进同一事务，避免目标默认授权在两个命令之间暴露业务数据。以下命令在仓库根目录运行，使用专用迁移角色；SQL 文件和备份同样含业务数据，应按备份管理要求加密保管或在验证后安全清理：

```bash
umask 077
pg_restore --no-owner --no-privileges --use-list=work-public.restore.list \
  --file=work-public.restore.sql work-public.dump
psql --dbname='service=work_cloudbase' --no-psqlrc --set=ON_ERROR_STOP=1 \
  --single-transaction --file=work-public.restore.sql \
  --file=supabase/migrations/20261108000000_cloudbase_server_permissions.sql
```

还原失败时保留日志并修复原因；事务回滚后重新核查目标状态。不要删除报错对象或跳过错误强行完成。成功恢复业务和迁移历史后，在配置 `DATABASE_URL` 指向目标库的 API 运行环境执行：

```bash
pnpm db:check
pnpm db:migrate
pnpm db:permissions
```

仓库保留 `supabase/migrations/` 历史目录名，迁移器依据 `public.schema_migrations` 跳过已应用文件，再执行新增的兼容迁移。不要先在空库应用全部业务迁移，再向同一批表恢复完整 schema 备份。

`--no-privileges` 不恢复源 ACL，目标的默认授权可能重新授予网关访问。即使备份中的迁移历史已经记录权限迁移，也必须执行可重复运行的 `db:permissions` 重新撤权。该命令在事务中复用同一份精确业务对象权限 SQL，不修改迁移历史；完成后再向独立 API 角色授予所需权限。

## 4. 核查权限和数据

以专用 API 数据库角色运行应用。若还原账号与 API 账号不同，明确授予业务表 DML、序列 USAGE / SELECT 及业务函数 EXECUTE；保留 SQL 函数所需的所有者和调用关系。不要给应用账号授予目标平台所有数据库的管理权限。

本项目的权限边界是 API 和 SQL transaction functions。CloudBase `anon`、`authenticated`、`service_role` 等网关角色不应能够绕过 API 直接读取或执行业务对象；检查 PUBLIC、显式 GRANT、角色继承与默认权限，并撤销意外授权。仅撤销 PUBLIC 不足以消除已有的显式角色授权。迁移和恢复后都要重新检查。

新增的 `20261108000000_cloudbase_server_permissions.sql` 只撤销本项目业务表、函数和所属序列的网关权限。迁移账号与 API 账号应独立于网关角色；如果网关角色通过所有权、继承或超级权限仍然可访问，迁移会以 `WORK_PLATFORM_GATEWAY_ROLE_HAS_ACCESS` 失败并回滚，需要先修正角色关系。旧历史迁移含整个 `public` schema 的撤权语句，因此已有数据库应恢复业务对象和迁移历史后增量执行，不要在包含托管对象的目标上直接重放全部历史。

切换前至少完成：

- 对比源快照与目标的每张业务表行数、主键集合或校验结果；核查 `schema_migrations`、序列值、触发器和 SQL 函数。
- 抽查工作空间、成员权限、任务层级、评论、工时、Agent 授权、审计和公开分享数据及其外键关系。
- 使用实际 API 角色验证正常读写及权限拒绝，核查事务失败会整体回滚。
- 在预演部署验证飞书回调、管理员引导、看板 / 任务操作、工时登记、Agent CLI、公开分享与提报；不要在生产库运行演示数据测试或数据库 reset。
- 核查 API 多副本的总连接数。每个进程默认最多 20 个连接，应结合独享实例连接容量配置部署规模。

可以先用只读 SQL 确认实例及迁移历史：

```sql
SELECT current_database(), current_user, version();
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm');
SELECT name, applied_at FROM public.schema_migrations ORDER BY name;
```

`pnpm lint`、`pnpm typecheck`、构建和本机 PostgreSQL 测试通过，只能说明代码和本地数据库行为已验证，不能证明目标 CloudBase 环境已连接或已有数据已迁移。

## 5. 切换与回滚

保持旧库停写，完成以上核查后，将生产 API 的 `DATABASE_URL` 切到目标实际连接串并滚动重启。复核 TLS、API 健康状态、飞书登录、关键读写、权限拒绝及错误日志，再恢复流量。新旧 API 副本不能分别向两套数据库写入。

短期保留旧数据库、备份及旧部署配置，不删除原数据。`DATABASE_URL` 优先于兼容变量 `SUPABASE_DB_URL`；需要回滚时停掉新库写入，并把 `DATABASE_URL` 恢复为旧库连接串，或清除它后使用旧兼容值，然后重启 API。

如果切换后新库已经产生写入，回滚前先导出并核对这段增量，明确如何合并回旧库。直接切回旧库会丢失这段业务变化，不能当作无损回滚。仅在双方数据已核对并完成最终切换验收后，再另行安排旧库退役。

## 官方依据

- [CloudBase 接入技能](https://docs.cloudbase.net/skill.md)；本次文档地址访问受限，已读取 [CloudBase 官方 GitHub 技能](https://github.com/TencentCloudBase/cloudbase-skills/blob/main/skills/cloudbase/SKILL.md)。
- [连接 PostgreSQL 数据库](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)。
- [CloudBase 官方 PostgreSQL 连接排障](https://github.com/TencentCloudBase/cloudbase-skills/blob/main/skills/cloudbase/references/postgresql-development-cloudbase/references/troubleshooting.md)：独享实例、TCP 和 VPC 前提。
