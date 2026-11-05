---
name: work-tasks
description: 用 Work CLI 查询和维护任务。遵循发现命令、读取操作 schema、确认人的委托、解析看板元数据、读取版本、幂等写入和核实结果的流程。
---

# Work 任务操作

先读取 `work skills read work-shared`。所有 ID 使用服务返回的 UUID，不根据名称猜测。用当前操作的 schema 获取字段，避免一次加载所有接口说明。

## 查询与解析目标

```bash
work commands
work schema tasks.list
work auth check --scope read
work workspace
work boards list
work boards get <board-id>
work tasks list --board <board-id> --q "支付回调" --limit 50
work tasks get <task-id>
```

看板详情给出状态、任务类型、泳道、里程碑、标签和可用成员。标题匹配到多个任务时，结合看板、负责人和内容消歧；只有无法可靠确定目标时才向用户确认。

`work tasks +mine` 按当前委托用户的负责人 ID 查询任务，不包含仅作为参与人的任务，也不跨授权工作空间。需要整理个人待办或风险时，再读 `work skills read work-workflow-triage`。

列表支持 `--board`、`--q`、`--state-group`、`--responsible-user`、`--limit`、`--cursor`。`--q` 是标题字面子串查询。完整查询需要检查后续游标；使用 `--page-all --page-limit 10` 时也要检查是否截断。字段投影可减少上下文，但不应省略当前决策需要的负责人、状态、日期或版本。

## 创建：保留一次意图的幂等标识

```bash
work schema tasks.create
work auth check --scope write
work boards get <board-id>
```

至少提供 `title`、有效的 `responsibleUserId`、新的 UUID `clientMutationId`。把完整请求保存到临时 JSON 文件或通过标准输入传入；复杂内容避免 shell 内联转义。

```json
{
  "title": "补齐支付回调重试机制",
  "responsibleUserId": "10000000-0000-4000-8000-000000000002",
  "priority": "high",
  "estimateDays": 3,
  "clientMutationId": "39d50644-bb57-4e24-b6b4-40658d915c8f"
}
```

示例 ID 只表示格式，不能直接用于真实操作。`estimateDays` 是工作天数，不是故事点。

```bash
work tasks create --board <board-id> --json work/create-task.json --dry-run
work tasks create --board <board-id> --json work/create-task.json
```

创建重试保留同一 `clientMutationId`、委托用户、看板和完整内容。请求内容相同会返回原任务的当前可见版本；改变内容、看板或跨空间重用标识会冲突，不能用于覆盖任务。原任务已删除或不可见时，不会创建替代任务。结果不确定时先查证，不能换 UUID 反复提交。同一操作内 JSON 对象字段顺序不影响比较，数组顺序仍有意义。

## 更新：先读版本，再提交最小修改

```bash
work schema tasks.update
work auth check --scope write
work tasks get <task-id>
```

以刚返回的 `version` 填入 `expectedVersion`，只提交用户要求改的字段。例如保存为 `work/update-task.json`：

```json
{
  "expectedVersion": 7,
  "priority": "high"
}
```

```bash
work tasks update <task-id> --json work/update-task.json --dry-run
work tasks update <task-id> --json work/update-task.json
```

状态等关联字段使用目标看板元数据里的 ID。`--dry-run` 只校验客户端输入并展示请求计划，不能证明服务端权限或业务约束会通过。

遇到 `VERSION_CONFLICT`，重新查询并理解变化。如果最新状态已满足用户目标，可据实报告；否则仅在原意图仍明确适用时基于新版本形成请求，不机械重放或强行覆盖。

## 删除与结果

只有用户明确要求删除对应任务时才使用 `--yes`：

```bash
work schema tasks.delete
work auth check --scope write
work tasks get <task-id>
work tasks delete <task-id> --expected-version <fresh-version> --yes
```

将完成或取消要求转为相应状态修改，不自动删除。报告实际操作、任务 ID／可用链接、最终版本与失败原因。超时后先确认数据状态，不能将未知结果报告为成功或再次执行新的创建意图。
