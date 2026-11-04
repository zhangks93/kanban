# Work CLI

Node.js 22.13+。在仓库根目录运行 `pnpm work --help`，或构建独立 CLI：

```bash
pnpm --filter @work/cli build
node packages/cli/dist/work.mjs --help
```

首次使用由人通过飞书登录并确认工作空间、范围和有效期：

```bash
pnpm work auth login --server https://work.example.com
# 需要修改任务时，重新申请带写权限的授权
pnpm work auth login --server https://work.example.com --write --name coding-agent
pnpm work schema
pnpm work boards list
pnpm work tasks list --limit 50
```

默认输出 JSON。`tasks create` 的 JSON 必须带调用方生成的 `clientMutationId`；重试使用同一 ID。`tasks update` 和 `tasks delete` 必须带读取到的任务版本。冲突退出码为 5，需要重新查询再决定。写命令支持 `--dry-run`，只进行本地检查。

凭据保存在专用配置目录，文件模式 `600`、目录 `700`；默认 Unix `$XDG_CONFIG_HOME/work` 或 `~/.config/work`，Windows `%APPDATA%/work`。可用 `WORK_CONFIG_DIR` 覆盖。`WORK_SERVER` 和 `WORK_TOKEN` 供已获得人工授权的无头运行使用，token 不应写入命令参数、日志或任务正文。凭据只发送到选定服务器；HTTPS 必须启用，本机回环开发允许 HTTP。

`auth status` 查询实际服务器身份。`auth logout` 请求撤销当前授权后删除本地凭据；`remoteStatus: "revoked"` 表示服务端已确认撤销，`"unavailable"` 表示当前凭据不可用、无法确认撤销，需要在 Web 的“Agent 访问”页面核对并撤销，`"no-token"` 表示没有当前凭据。网络失败时保留凭据以便重试。若使用环境变量，退出后还需由调用方清理 `WORK_TOKEN`；不同的本地已存授权会保留。

退出码：`0` 成功、`2` 参数、`3` 未登录/过期、`4` 无权限、`5` 冲突、`6` 网络/配置/响应、`1` 其他服务端或授权流程错误。

完整鉴权说明见仓库 `docs/agent-access.md`，配套 skill 见 `skills/work-platform/SKILL.md`。
