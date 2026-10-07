# 验证记录

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
