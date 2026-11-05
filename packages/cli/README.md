# Work CLI

Node.js 22.13+。在仓库根目录运行 `pnpm work --help`，或构建独立 CLI：

```bash
pnpm --filter @work/cli build
node packages/cli/dist/work.mjs --help
```

先发现命令，再读取单项契约。以下命令可离线使用，不读取凭据：

```bash
pnpm work commands --json
pnpm work schema tasks.update
pnpm work skills list
pnpm work skills read work-shared
```

`schema` 不带参数时返回随 CLI 分发的完整 API 契约。四个内置 skill 按入口、共享规则、任务操作、只读分诊分层；独立构建会把相同 Markdown 打包进可执行文件。

首次使用由人通过飞书登录并确认工作空间、范围和有效期：

```bash
pnpm work auth login --server https://work.example.com
# 需要修改任务时，重新申请带写权限的授权
pnpm work auth login --server https://work.example.com --write --name coding-agent
pnpm work auth check --scope write
pnpm work boards list
pnpm work tasks list --limit 50
```

Agent 可先运行 `auth login --no-wait`，获得可交给人的验证链接和验证码，再在批准后运行 `auth complete`。设备密钥只保存在权限为 `600` 的 `pending.json`，不会出现在 stdout 或 stderr。完成、拒绝和过期会清理待授权文件；网络错误会保留文件，以便安全恢复。`auth check --scope read|write` 实时检查服务端权限，缺少 scope 时以退出码 `4` 返回 `granted`、`missing` 和恢复建议。

`tasks +mine` 先确认当前授权人的 ID，再查询该人的负责事项。它与 `tasks list` 使用相同的权限和筛选条件。查询支持 `--format json|ndjson|table` 及安全的 `--fields id,title,version` 字段投影；分页信息会保留。写命令只输出 JSON，拒绝格式和投影选项。

`tasks list --page-all --page-limit 10` 自动翻页，默认最多 10 页，最多允许 100 页、每页最多 100 项。结果包含 `pagination` 和 `nextCursor`，达到页数上限或遇到重复游标时会明确标记 `truncated`。这不是数据库快照，查询期间的数据变更仍可能影响结果。

任务列表的 NDJSON 会逐页输出 `{type:"page",page,itemCount,nextCursor}`，逐行输出 `{type:"row",page,data}`，最后输出 `{type:"summary",pagination,nextCursor}`。中途失败时保留已输出行、以非零码退出，并在 stderr 的 `error.detail.partial` 标明已读页数、条数、已输出行数及恢复游标；不会输出成功 summary。JSON 和 table 在读取完成后统一输出。

默认输出 JSON。`tasks create` 的 JSON 必须带调用方生成的 `clientMutationId`；重试使用同一 ID。`tasks update` 和 `tasks delete` 必须带读取到的任务版本。冲突退出码为 5，需要重新查询再决定。写命令支持 `--dry-run`，只进行本地检查。

凭据保存在专用配置目录，文件模式 `600`、目录 `700`；默认 Unix `$XDG_CONFIG_HOME/work` 或 `~/.config/work`，Windows `%APPDATA%/work`。可用 `WORK_CONFIG_DIR` 覆盖。`WORK_SERVER` 和 `WORK_TOKEN` 供已获得人工授权的无头运行使用，token 不应写入命令参数、日志或任务正文。凭据只发送到选定服务器；HTTPS 必须启用，本机回环开发允许 HTTP。

`auth status` 查询实际服务器身份。`auth logout` 请求撤销当前授权后删除本地凭据；`remoteStatus: "revoked"` 表示服务端已确认撤销，`"unavailable"` 表示当前凭据不可用、无法确认撤销，需要在 Web 的“Agent 访问”页面核对并撤销，`"no-token"` 表示没有当前凭据。网络失败时保留凭据以便重试。若使用环境变量，退出后还需由调用方清理 `WORK_TOKEN`；不同的本地已存授权会保留。

退出码：`0` 成功、`2` 参数、`3` 未登录/过期、`4` 无权限、`5` 冲突、`6` 网络/配置/响应、`1` 其他服务端或授权流程错误。

完整鉴权说明见仓库 `docs/agent-access.md`，配套 skill 见 `skills/work-platform/SKILL.md`。
