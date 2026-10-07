# 验收映射

| 规格主题           | 实现                                                        | 验证                                                |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------- |
| M0 基础            | workspace packages、tokens、CI、db scripts                  | foundation.test.ts、00_foundation.sql               |
| M1 身份 / Owner    | auth middleware、auth.ts、m1 SQL                            | auth.test.ts、01_owners.sql、concurrency.test.ts    |
| M2 Board / Task    | boards/tasks/collaboration、m2 SQL、BoardScreen、TaskDetail | tasks.test.ts、02_tasks.sql、05_invariants.sql、E2E |
| M3 WIP             | focus.ts、m3 SQL、MyWork                                    | wip.test.ts、03_wip.sql、concurrency.test.ts        |
| M4 三入口          | plugin-sdk、API/Web registry、workspace_plugin              | plugins.test.ts、04_plugins.sql                     |
| M5 R&D             | plugin-rnd、m5 SQL、Domain/Task/Lane UI                     | plugin SQL/API/E2E                                  |
| M6 Ops / hardening | plugin-ops、inbox、m6 SQL、Search/Intake/Audit/Notification | inbox.test.ts、E2E screenshots/performance          |

`docs/decisions.md` 记录未规定的实现选择。`docs/visual-checklist.md` 记录 UI 审查原则。未来变更必须保留迁移和并发回归检查。
