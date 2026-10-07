# 验证记录

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
