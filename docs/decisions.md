# 实施决策

- pnpm + Node.js 22/24 LTS，所有 TypeScript strict。固定 pg 驱动。
- 本地联调与正式部署均连接 Supabase Hosted PostgreSQL，不使用 Supabase Auth。默认启动自动迁移，不重置数据或导入演示账号；自动化测试使用独立的本机 PostgreSQL 15+ 与 pgTAP。
- 前端采用系统中文字体、4px 间距基线、低饱和绿色语义强调色。Radix/shadcn 行为基座统一覆盖产品 token。
- 不安装附件中建议的外部设计技能；按文档 UI checklist 自检，该技能不影响运行或 CI。
- 飞书稳定标识采用应用范围 open_id UNIQUE；fake Feishu 为独立本地进程，生产拒绝 override。
- Session 使用 256-bit 随机 token，HMAC 签名 cookie，数据库只保存 SHA-256；12 小时过期。OAuth state 绑定 HttpOnly cookie，并由 DELETE RETURNING 一次性消费。
- Mutation Origin 必须等于 APP_BASE_URL；next 仅接受本站相对路径。Owner 使用延迟约束检查事务最终状态。
- Task 变更在 scope shared lock 后，保守锁定本 Workspace 全部 membership 的 WIP user 集合（有序）。该超集避免 Worker 关系并发修改导致漏锁，代价是同 Workspace Task 写入更保守；Focus 仅锁当前 user。实际生产规模须用性能基准评估更细粒度方案。
- Tree lock 顺序为 Workspace scope → Board scope → Board tree → WIP users → Task rows；所有涉及 parent 的函数与 trigger 复用递归校验。

- API 生产构建使用 esbuild 将 workspace TS packages 打包为 Node ESM，第三方服务端包保持 external；避免运行时直接解析 workspace `.ts` exports。
- Owner、Scope、WIP、Task row lock 由数据库函数获取；直接 SQL 的一致性由 FK / triggers / deferred constraints 再次保护。Membership / Worker / Focus 的复合主键不可更改；Workspace membership 用 inactive 撤权，不硬删除仍被 Board membership 引用的行。
- `state_group` 创建时由 state 决定；transition 自动派生，单独伪造 group 拒绝。Parent 不保存 depth，递归同时验证 ancestors 与 subtree height。
- 编译安装的插件名单由 API/Web 各自 composition root 决定；Core 可用 `buildApp([])` 验证独立运行。所有 plugin task fields 通过 Core `require_task_edit` + 一次 version bump。
- 扩展领域对象首版提供创建与读取；Task/Lane 扩展字段可编辑；未自行添加领域对象批量导入、动态脚本或插件市场。
- 任务列表首版单次最多返回 2,000 项；支持规格的 1,000 卡片场景。单个完整 Task 路由通过 Board+seq 独立查询，不依赖列表上限。更大列表分页是后续扩展点。
- sort_key 使用 binary C collation；新建任务使用合法 base-62 integer keys，拖拽使用 fractional-indexing。指针拖拽用 pointerWithin，键盘拖拽回退 closestCorners。
- Participant 选择即时显示本地 pending 状态，所有 Task version-bearing 请求共用串行队列；失败会清空该 Task 后续请求并 refetch 已确认数据。
- 通知不持久化 title 等敏感 payload；返回前 JOIN 当前可读 Task。搜索和 My 同样每条校验当前 read permission。
- 本地调试默认使用真实飞书 OAuth，Session 密钥由 setup 自动生成并持久化到 .env。Fake Feishu 与演示数据只服务于隔离测试；真实外部服务需要用户提供相应配置。
