# 验证记录

## 2026-11-09：自定义 schema 下飞书重复登录失败

- 真实回调诊断：`auth.login` 返回 HTTP 404 / `DATABASE_42P01`。在 PGlite 中使用 `project_management`、`anon` 与同一用户重复登录，复现 `relation "workspace_member" does not exist`。旧版认证分支提前返回，用户更新的延迟约束直到 RPC 的 schema 和执行角色恢复后才执行。
- 修复认证分支，在返回前执行 `SET CONSTRAINTS ALL IMMEDIATE`。回归验证旧函数失败、补丁升级后成功、补丁重复执行、新安装后执行补丁、保留用户 ID / 管理员权限 / 工作空间 owner 角色 / 原有任务，以及失败事务不遗留 Session。CloudBase 隔离测试 33 项通过，类型检查与相关 ESLint 通过。
- 为已初始化环境提供 `.cloudbase/patches/20261109-returning-login.sql`，仅更新 `work_platform.dispatch`。新安装 SQL 与补丁的健康版本均为 3；`pnpm cloudbase:check` 会拒绝把旧版健康响应当作已完成修复。
- 现有 Key 调用管理员 SQL 接口返回 `DATABASE_PERMISSION_DENIED`；用户在 SQL 编辑器应用补丁后，远端 `pnpm cloudbase:check` 已通过，确认 `project_management` / `schemaVersion=3`、服务端签名与 OAuth state 创建和消费正常。完整真实飞书登录仍需从登录页重新发起验证。

## 2026-11-08：飞书 OAuth / Session + CloudBase HTTPS RPC

登录和身份验证继续走飞书，用户、角色、Session 和业务数据存储到 CloudBase PostgreSQL。前一轮误加的 CloudBase Auth 登录、浏览器直连与静态部署模式已移除。

- 使用模拟飞书 HTTP 响应与 PGlite 验证实际 Fastify OAuth 回调、一次性 state、HttpOnly Cookie、重复登录保留用户 ID / 角色、账号停用、CSRF 与退出清理 CloudBase Session。
- CloudBase 数据工作流使用服务端签名 RPC，验证签名篡改、过期、防重放、身份隔离、任务版本、WIP、工时、插件、公开分享及 Agent 授权与幂等写入。没有访问或修改旧远端数据库。
- 隔离测试不能代替真实飞书应用、CloudBase 网关、并发连接和生产部署验证。远端仍需执行新生成的初始化 SQL，以配置服务端签名入口；该文件含私有签名配置，不公开发布。
- 以下旧记录反映各自当时的测试环境与接入方式。

## 2026-11-08：CloudBase 国内站数据库接入准备

目标记录为 `final-pony-d7gnzgdj1b8ab4f99` / 上海 `ap-shanghai`。以下验证使用 Node.js 24、本机 PostgreSQL 17.11 / pgTAP 1.3.3 和 Linux Chromium，未连接目标 CloudBase 数据库。

- ESLint、TypeScript、Web / API / CLI 构建、前端密钥引用扫描和生产 API 启动检查通过。
- Vitest 全量 16 个文件、69 项测试通过；pgTAP 87 个断言通过。配置测试验证新连接串优先、旧配置回滚、真实 `pg.Client` 的 CA 验证配置及远端 reset / seed 拒绝。
- Playwright 定向 11 项通过，覆盖任务事务、参与人、WIP、基础数据、桌面与手机工时、公开分享和 Agent 授权 / 拒绝；本轮未重复全量视觉和性能用例。
- 模拟 CloudBase 的 `anon`、`authenticated`、`service_role` 默认授权及敏感列授权，确认精确业务对象撤权后无法直接读写或调用业务 RPC，私有 API 仍可用。
- 本地备份恢复预演核对 41 张业务表的行数与逐行内容摘要、14 条迁移历史和 57 个业务触发器一致；恢复后重新撤权，并确认目标已有的模拟托管函数仍可用。

原文 `docs.cloudbase.net/skill.md` 访问返回 403，已读取官方 GitHub 技能及 PostgreSQL 连接说明。当前运行环境的网络策略仍拦截国内管理端点，且尚未观察到目标数据库密钥注入；CloudBase 登录、实例规格 / VPC / TLS、远端数据迁移和生产切换仍待实际验证。

## 2026-11-04：人授权的 Agent 接入

环境：Node.js 24、可丢弃的本机 Docker PostgreSQL 17 / pgTAP 1.3.3、Linux Chromium 151、模拟飞书。

- ESLint、TypeScript、Web / API / 独立 CLI 构建、Web 密钥引用扫描和生产 API 启动检查通过。
- Vitest 全量 16 个文件、65 项测试通过，包含 8 项授权、6 项 Agent 数据和 8 项 CLI 测试。随后补充退出遇到 401 的准确状态说明，CLI 共 9 项定向复测通过。
- pgTAP 69 个断言通过；新增授权及幂等迁移从空库成功应用，既有迁移未修改。
- Playwright 全量 18 项通过，包含飞书登录后保留设备码、显式选择工作空间、默认只读、收窄写权限申请、拒绝申请，以及撤销后旧凭证立即失效。既有视觉基线与 1,000 卡片性能用例通过，未更新截图基线。
- 人工检查授权页桌面与 390px 截图；移动端无横向溢出，并修整移动端页面标题和装饰图标。
- 授权集成测试覆盖一次性领取、凭证哈希存储、Cookie / Bearer 隔离、CSRF、有效期与撤销、用户停用及成员资格变化；数据测试覆盖跨空间 / 受限看板边界、真实 viewer 拒写、分页游标、并发创建、请求内容一致性、版本冲突与审计归属。
- 查询请求日志在响应后尽力持久化；任务变更审计与业务事务一致。撤销限制后续请求，已经进入事务的请求可能完成。

升级执行 `pnpm db:migrate`，应用 `20261104020000_agent_access.sql` 和 `20261104021000_agent_idempotency.sql`，无需重置业务数据。CLI 与 skill 使用说明见 [Agent 接入](agent-access.md)。本次未连接真实飞书、Hosted Supabase 或生产环境。

## 2026-11-04：统一基础数据与公开看板

环境：Node.js 24、独立 Docker PostgreSQL 16 / pgTAP 1.3.4、Linux Chromium；仅使用可丢弃的本机测试数据库。

- TypeScript、ESLint、Web / API 构建、Web 密钥引用扫描、生产 API 启动检查通过。
- Vitest 13 个文件、43 个测试通过；pgTAP 69 个断言通过。
- 浏览器共 16 个用例完成验证：完整回归中的 15 项通过，1,000 卡片用例因载入超过默认 5 秒断言窗口而失败；将该用例的载入等待上限调整为 15 秒后单独复测通过，虚拟化数量、末项滚动及任务打开断言保持不变。
- 新增浏览器用例覆盖基础数据创建与两插件复用、分享链接保存及复制、匿名只读、研发需求和运维工单提报、内部受理转任务、撤销分享，以及 390px 公开页无页面横向溢出。
- 检查公开页桌面 / 手机截图，核对更新 My Work 与任务完整详情的两张手机基线；其他既有截图按原容差通过。
- 升级模拟在独立事务 schema 中重放旧版本，再应用新增迁移，验证同名消歧、旧模块 / 任务 / 泳道数据保留。旧模块不会被转换为业务项目，新项目由用户明确创建和关联。
- 分享接口测试覆盖管理权限、公开响应白名单、跨域提交拒绝、链接轮换与撤销、并发重复提报去重、数据库限流和受信代理来源校验。联系人和访客身份只保存在内部提报记录中。

上线使用新增的 `20261104000000_unified_foundation_data.sql` 与 `20261104010000_board_sharing.sql`，执行 `pnpm db:migrate`，无需重置或重新导入现有数据。反向代理与访客 IP 配置见部署文档。本次未连接真实飞书、Hosted Supabase 或生产环境。

## 2026-10-07：Task 预估与实际工时

环境：Node.js 24、独立 PostgreSQL 17.11 / pgTAP 测试实例、Linux Chromium；仅使用隔离的本机测试数据库，未使用 Docker。

- lint、TypeScript、Web / API 构建、Web 产物密钥引用扫描和生产 API 启动检查通过。
- Vitest 共 34 个测试通过；新增 8 项覆盖斐波那契预估与清空、整数小时及日期校验、重复提交幂等、日志作者与版本控制、跨任务并发每日上限、历史人员归属、权限隔离、完整汇总与分页、删除/归档后保留历史。
- pgTAP 共 69 个断言通过，包含估算档位、直接 SQL 更新版本、跨工作空间每日上限、幂等请求与日志约束。
- Playwright 共 13 个测试通过；新增桌面 1440px / 手机 390px 的预估创建和修改、工时登记/修改/删除、统计筛选与累计工时对比流程。原有管理流程、原子拖拽、WIP 替换、参与人修改及 1,000 卡片检查通过。
- 截图共 10 张：My / Board / Peek / Full 的桌面和手机基线，以及新增工时统计页桌面和手机基线。人工检查任务详情与统计布局；视觉测试固定浏览器日期，避免默认工作日期导致每日差异。

数据库通过新增 `20261007000000_m7_task_effort.sql` 升级，原有迁移未修改。现有数据的预估默认为 NULL；任务版本与日志版本独立。统计只包含当前可见任务，1 天 / 人天统一按 8 小时换算。

本次未连接真实飞书或 Hosted Supabase，验证结果为本机隔离环境结果。

## 2026-10-07：本地启动流程优化

环境：Node.js 24、独立 PostgreSQL 18.4 测试实例、Linux Chromium。该实例仅用于验证，不是项目启动依赖；未使用 Docker。

- lint、TypeScript strict、Web / API 构建与 Web 产物密钥引用扫描通过。
- Vitest 共 26 个测试通过，覆盖配置初始化、缺失配置提示、密钥持久化、远程 reset / seed 拒绝、API 与数据库行为，以及先登录后配置管理员、引导变量移除后保持管理员身份。
- pgTAP 共 59 个断言通过；Playwright 共 11 个测试通过，包含 8 张桌面 / 手机截图基线。
- 实际执行 `pnpm setup` 与 `pnpm dev`：新数据库自动执行 8 个迁移，不导入演示账号；Web 5180 / API 3101 的代理、健康检查、未登录 401 与真实飞书授权重定向均通过。
- 将 `pgcrypto` / `pg_trgm` 预先安装到 `extensions` schema，确认迁移与查询正常；重复迁移保留已有用户数据。
- `NODE_ENV=production` 的 API bundle 健康检查与未认证 401 验证通过。

真实飞书授权回调及 Hosted Supabase 网络 / TLS 联调仍需用户提供目标凭据；本次未连接这两项外部服务。修改后的 GitHub Actions 尚未在远端运行。

## 2026-10-06：初始实现

时间：2026-10-06，Asia/Shanghai。环境：Node.js 24、PostgreSQL 15、Chromium/Linux。

| 检查                      | 结果                                                       |
| ------------------------- | ---------------------------------------------------------- |
| TypeScript strict / lint  | 通过                                                       |
| migrations reset + seed   | 通过，M0–M6 共 8 个迁移文件                                |
| pgTAP                     | 59 个断言通过                                              |
| Vitest                    | 8 个文件 / 18 个测试通过                                   |
| Playwright                | 11 个测试通过                                              |
| 截图回归                  | My / Board / Peek / Full Detail，桌面和手机共 8 张基线通过 |
| 窗口尺寸                  | 390、1280、1440、1920px，无 document 横向溢出              |
| Keyboard / reduced motion | Dialog 焦点留在弹窗内；reduced motion 下移动端流程可用     |
| 1,000 卡片                | 查询成功、cell 虚拟化、滚动到第 1,000 项并打开 Peek 通过   |
| API / Web 构建            | 通过                                                       |
| Web bundle secret scan    | 通过                                                       |
| 生产 API bundle 启动      | PostgreSQL health + 未认证 401 smoke 通过                  |

并发测试实际使用多个 PostgreSQL connection，覆盖跨 Workspace Focus 容量、最后 Owner 同时降级、账号停用与 Owner grant、首次 Focus 与成员撤权、新 Task 与 scope exclusive、Focus 与负责人/参与人/状态/删除/账号/成员/访问模式/Board archive/Board revoke 的竞争。最终检查不残留 `NOT can_focus_task` 的 Focus。

API/数据库检查覆盖权限谓词分离、restricted viewer、管理身份不等于 Worker、历史 Worker 撤权后的直接 Task/comments/resources/My/Search/Notification 读取、复合 move 整体回滚和单次 version、Participant 转 Responsible 的合法 Focus 保留、Parent subtree height、Plugin Core version 与依赖保护、Intake 原子接受和幂等。

浏览器检查实际执行 pointer 对角拖拽并统计 `/move` 请求次数；快速 Participant 修改检查第二次请求使用前一次响应 version；同时覆盖 My WIP Replace、插件 runtime gating、Board 创建与设置、泳道、标签、任务、评论、资源和需求接受流程。

性能采样见 `performance.json`：本地 1,000 Task Board 读取约 1.45s，50 次常用 Task PATCH 的 p95 约 9.68ms。采样使用 Fastify inject 和本地数据库，不含互联网、Hosted Supabase 延迟、反向代理或生产并发负载；不能据此保证生产 SLO。

远端 GitHub Actions、真实 Feishu、Hosted Supabase、Sentry 与目标环境 p95 尚未验证。本文件记录已执行的本地检查，不将文档中的全部验收场景声称为逐项独立穷举测试。
