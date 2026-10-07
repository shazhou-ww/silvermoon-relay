# Relay API v1 补充契约

本文补充 `Idea.md` 的 wire-level 设计。若两者出现冲突，以 `Idea.md` 的理想契约为
准；实现阶段可以细化字段，但不能弱化事实边界、幂等性、所有权或恢复语义。

## HTTP 资源

所有响应为 JSON，时间为 UTC RFC 3339，成功响应包含 `requestId`。列表使用 opaque
`cursor`，排序稳定且不接受任意 SQL 排序字段。

### `GET /v1/daemons`

返回当前用户拥有的 daemon：

```json
{
  "items": [
    {
      "id": "daemon-01",
      "displayName": "Laptop",
      "connection": "online",
      "lastSeenAt": "2026-10-07T01:30:00Z",
      "protocolVersion": 1,
      "capabilities": ["task.v1", "activity.v1"]
    }
  ],
  "nextCursor": null,
  "requestId": "0199..."
}
```

`connection` 为 `online | offline | stale`。它是带观测时间的 presence 投影，不是
daemon 能完成任务的承诺。

### `POST /v1/tasks`

请求：

```json
{
  "requestId": "a4f8f576-d59b-4b28-9cf6-f55f7ca548c3",
  "daemonId": "daemon-01",
  "prompt": "继续这个 idea"
}
```

首次持久接收返回 `202`；相同 payload 的幂等重放返回 `200` 并带
`idempotentReplay: true`。同一用户和 `requestId` 对应不同规范化 payload 返回
`409 request-id-conflict`。daemon 离线时任务仍可进入有界队列；队列已满时在写入
前返回 `429 queue-capacity-exceeded`。

```json
{
  "task": {
    "id": "0199...",
    "requestId": "a4f8f576-d59b-4b28-9cf6-f55f7ca548c3",
    "daemonId": "daemon-01",
    "delivery": "queued",
    "execution": "awaiting",
    "latestSequence": 1,
    "createdAt": "2026-10-07T01:31:00Z",
    "updatedAt": "2026-10-07T01:31:00Z"
  },
  "idempotentReplay": false,
  "requestId": "0199..."
}
```

### `GET /v1/tasks/{taskId}`

返回任务当前投影。`delivery` 为
`queued | offered | accepted | rejected | unknown`；`execution` 为
`awaiting | running | completed | failed | unknown`。响应可包含最终回复，但不把
活动摘要拼接成回复。

### `GET /v1/tasks/{taskId}/events`

普通 JSON 模式使用 `Accept: application/json` 和 `after` 游标读取一页历史；
`Accept: text/event-stream` 建立 SSE。SSE 的 `id` 等于任务事件 `sequence`，
`event` 等于事件 `type`，`data` 是同一事件 JSON。客户端可以用
`Last-Event-ID` 恢复；同时提供 `after` 时两者必须一致，否则返回
`400 cursor-conflict`。

## 统一错误

```json
{
  "error": {
    "code": "request-id-conflict",
    "message": "The requestId is already bound to another payload.",
    "retryable": false,
    "details": {}
  },
  "requestId": "0199..."
}
```

稳定 code 至少覆盖认证、CSRF、所有权/不存在、schema、版本、幂等冲突、daemon
拒绝、队列容量、速率限制、游标过旧和内部暂时失败。`message` 面向人类且不作为
程序分支依据；`details` 只包含安全、稳定、文档化的字段。

## Daemon WebSocket

握手继续使用 `GET /v1/daemon/connect`、connection token 和
`X-Silvermoon-Daemon-Id`。连接建立后的第一条 daemon 消息必须是：

```json
{
  "type": "daemon.hello",
  "protocolVersion": 1,
  "daemonId": "daemon-01",
  "connectionId": "0199...",
  "capabilities": ["task.v1", "activity.v1"],
  "resume": {
    "acceptedDeliverySequence": 42,
    "uploadedEventSequence": 18
  }
}
```

Relay 以 `relay.welcome` 回应选定版本、连接 generation、心跳周期和服务端游标。
协商完成前不投递任务。不支持的版本或必需能力缺失时，以结构化
`protocol.error` 后关闭连接。

### Relay 到 daemon

- `task.deliver`：包含 `taskId`、`requestId`、单调 `deliverySequence`、prompt、
  创建时间和 payload hash。
- `relay.ping`：包含 nonce 和服务端时间，仅用于连接活性，不推进任务状态。
- `delivery.reconcile`：要求 daemon 回报指定 delivery 范围的持久接收结果。

### daemon 到 relay

- `delivery.accepted`：任务已写入 daemon 持久 inbox；重复确认安全。
- `delivery.rejected`：任务未进入 inbox，包含稳定 reason code。
- `task.started`：Agent 已实际开始处理。
- `task.activity`：有界、非最终的活动观察；不得被客户端解释为回复或完成。
- `task.reply`：一次正式最终 Agent 回复，并使 execution 进入 `completed`。
- `task.failed`：正式终止失败，包含稳定、脱敏的 reason code。
- `daemon.pong`：只证明连接活性。

每个 daemon 上行任务事件携带稳定 `eventId`、`taskId`、该 daemon 单调的
`eventSequence` 和 connection generation。Relay 回应 `event.committed`，其中
`taskSequence` 是写入任务事件流后的权威序列。只有收到该回应后 daemon 才能推进
已上传游标；超时后的重发必须复用相同 `eventId`。

## 事件与状态规则

任务事件至少包括：

- `task.created`
- `delivery.offered`
- `delivery.accepted`
- `delivery.rejected`
- `delivery.unknown`
- `execution.started`
- `execution.activity`
- `execution.replied`
- `execution.failed`
- `protocol.conflict`

`delivery.accepted` 不能自动产生 `execution.started`；`execution.activity` 不能自动
产生 `execution.replied`。断线时，只有未能确认的维度进入 `unknown`，已经持久确认
的事实不回退。迟到的有效事件可以从 `unknown` 澄清到确定状态，但不能覆盖已经
提交的终止事实；冲突终止事件记录 `protocol.conflict` 并进入人工可诊断状态。

## 持久化与恢复

- D1 的 `tasks` 保存用户可查询投影与幂等 payload hash，`task_events` 保存追加事件。
- daemon Durable Object SQLite 保存当前 generation、delivery outbox、确认游标、
  daemon event inbox 和 D1 投影同步游标。
- DO 先持久化 outbox 再发送；daemon 确认后推进 outbox 游标。daemon 上行事件先按
  `eventId` 幂等写入 inbox，再异步投影到 D1。
- D1 投影写入必须按源游标 compare-and-set；重复同步无副作用，跳号则停止并对账。
- DO 唤醒、WebSocket hibernation、Worker 重启及任一写入边界失败后，都从持久游标
  恢复，不根据内存推断消息是否已处理。

## 安全与容量

- 每个 HTTP 查询都绑定 browser session 的 user ID；资源不属于当前用户时与不存在
  使用相同外部语义。
- 每条 daemon 消息绑定握手得到的 user、daemon、token 与 generation，忽略客户端
  自报的身份字段作为授权依据。
- 对单用户提交速率、单 daemon 队列深度、并发 SSE、prompt、活动和回复大小设置硬
  上限；`429` 包含标准 `Retry-After`。
- 日志不记录 prompt、活动、回复、cookie 或 token，只记录相关 ID、消息类型、字节
  数、耗时、结果 code 和 Cloudflare request ID。
- JSON 拒绝重复键、非有限数字、未知的必需枚举和超出上限的嵌套数据；协议 schema
  默认拒绝未声明字段，明确标记的扩展容器除外。

## 机器可读契约

- `packages/protocol` 是运行时验证与 TypeScript 类型的实现源。
- OpenAPI 3.1 描述 HTTP、错误、认证、分页和 SSE 事件 payload。
- AsyncAPI 描述 WSS 握手、方向、消息、版本和关闭 code。
- CI 对所有示例执行 schema 验证，并验证 Worker 路由、共享 schema 与两份描述没有
  漂移。
