# Relay API v1 补充契约

本文补充 `Idea.md` 的 wire-level 设计。若两者冲突，以 `Idea.md` 为准。Relay API
协调 Silvermoon route 的交互和观察，不定义 task 或复制 Silvermoon lifecycle。

## 核心资源

### Client

`client` 是用户拥有的逻辑 relay endpoint。daemon 可以作为 connector kind，但不作为
资源 identity：

```json
{
  "id": "client-01",
  "displayName": "Laptop",
  "connection": "online",
  "lastSeenAt": "2026-10-07T01:30:00Z",
  "capabilities": {
    "silvermoonReportProtocol": 1,
    "eventV2": true,
    "agentObservation": "activity",
    "resumeSession": true,
    "sendWhileRunning": true
  },
  "connector": {
    "kind": "daemon",
    "version": "0.1.0"
  }
}
```

`connection` 是 presence observation，不承诺 route 可解析、Agent session 健康或消息
已处理。

### Registered project

Project 以 relay 生成的 opaque `projectId` 暴露，响应同时提供 canonical
credential-free `projectUrl`。connector 只有在本机 `LocalProjectRegistry` 已成功
注册并验证 project 后才能公布它。Relay 不接收或返回本机 filesystem path。

### Idea route

所有运行时操作使用：

```json
{
  "clientId": "client-01",
  "projectId": "project-01",
  "projectUrl": "https://github.com/example/project.git",
  "ideaId": "01M4A0NV95NFGRQRJJNPR7W417"
}
```

Wire request 使用 `projectId`；connector 在授权后将其解析为已登记的 canonical
`projectUrl`，再构造 Silvermoon `IdeaRoute { projectUrl, ideaId }`。Alias 只用于
展示和搜索，不作为 route identity。

## Browser HTTP API

所有 API 使用 browser session、Origin 与 CSRF 边界；响应 `Cache-Control: no-store`
并含 relay `requestId`。资源不属于当前用户时与不存在使用相同外部语义。

除顶层 client collection 外，所有资源路由都按所有权层级嵌套：

```text
/v1/clients/{clientId}
/v1/clients/{clientId}/projects/{projectId}
/v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}
```

`clientId`、`projectId` 和 `ideaId` 在每层都参与授权与 route correlation。API 不提供
平行的 `/routes/...` shortcut，以免同一 `IdeaRoute` 出现两套 canonical URL。

### Discovery

- `GET /v1/clients`
- `GET /v1/clients/{clientId}`
- `GET /v1/clients/{clientId}/projects`
- `GET /v1/clients/{clientId}/projects/{projectId}/ideas`

Idea 列表来自 connector 在注册 project root 中调用项目自身版本的
`silvermoon list-ideas --json` 后的 structured observation。Relay 不扫描 arbitrary
worktree，也不从数据库中派生 phase。该 runtime boundary 与 `next(route)` 分离：
inventory 查询不选择 idea，route 导航不隐式列出 inventory。

### `GET /v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}/next`

connector 调用 `ProjectRuntime.next(route)`，响应保留：

```json
{
  "protocolVersion": 1,
  "exitCode": 0,
  "report": {
    "intention": {},
    "observation": {},
    "actions": {},
    "response": {}
  },
  "observedAt": "2026-10-07T01:31:00Z",
  "requestId": "0199..."
}
```

Relay 只验证已支持的 envelope/version/route correlation，不重写四个 projections。
`exitCode: 1` 是 structured invalid/unavailable report，不转成 transport 500。

### `GET /v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}/events`

读取项目自身 Silvermoon event stream 的 projection。首次读取要求 full replay；后续
可以传准确 `afterLength` 与 `afterDigest`，connector 调用
`ProjectRuntime.readSince`。返回 cursor：

```json
{
  "eventLog": {
    "length": 423,
    "digest": "c4015dbdf87bb7a42854a8b11a02c5967ebef07a",
    "sequence": 4
  },
  "events": [],
  "requestId": "0199..."
}
```

changed/deleted prefix、非 record byte boundary 或 malformed receipt 是显式 conflict，
不能自动 full reset 后继续 mutation。

### `POST /v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}/interactions`

请求：

```json
{
  "interactionId": "a4f8f576-d59b-4b28-9cf6-f55f7ca548c3",
  "message": "继续实现这个 idea",
  "expectedEventLog": {
    "length": 423,
    "digest": "c4015dbdf87bb7a42854a8b11a02c5967ebef07a"
  }
}
```

成功响应为 `202`，表示 connector 已通过 `appendInteraction(type: "ping")` 将消息条件
追加到项目 event log，并已建立后续 Agent send observation；它不表示 Agent 已消费：

```json
{
  "interaction": {
    "id": "a4f8f576-d59b-4b28-9cf6-f55f7ca548c3",
    "repository": {
      "state": "recorded",
      "type": "ping",
      "sequence": 5,
      "length": 512,
      "digest": "409b76089b860749160c1e1de91f03809359a2d7"
    },
    "delivery": {
      "state": "queued",
      "boundary": "Agent SDK accepted the send request."
    },
    "reply": {
      "state": "pending"
    }
  },
  "requestId": "0199..."
}
```

如果 ping 已记录但 SDK send 结果不确定，响应仍保留 repository fact，并将 delivery
设为 `unknown`；服务端不得自动 resend。相同完整 payload 的 `interactionId` 重放返回
同一 interaction，payload 或 route 不同返回 `409 interaction-id-conflict`。

### Interaction observation stream

`GET /v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}/interactions/{interactionId}/observations`
使用 SSE。Relay observation stream 的 opaque SSE ID 与 Silvermoon event-log cursor
完全独立。事件包括：

- `delivery.observed`：adapter delivery union 的逐项 observation；
- `session.observed`：`running | idle | gone | unknown`；
- `activity.observed`：message 或 tool name/state；
- `reply.observed`：正式 final reply 已从 `AgentAdapter.events` 产生；
- `reply.recorded`：同一 reply 已通过 exact-cursor `pong` 写入项目 event log；
- `reconciliation.required`：项目 prefix、session binding 或 route owner 需人工协调。

断线可按 SSE cursor 续传 relay observations，但这不推进 Silvermoon event cursor。

## Interaction 编排

connector 对新 interaction 按以下顺序执行：

1. 验证 user/client/token/route lease 与本机 registry mapping。
2. 使用 `ProjectRuntime.replay/readSince` 验证 exact event prefix。
3. 调用 `appendInteraction({ type: "ping", message, expectedLength,
   expectedDigest })`。
4. 持久化 append receipt 与 interaction idempotency record。
5. 调用 `AgentAdapter.start(route)`；创建或恢复 route 的 durable session binding。
6. 订阅 `observe(route)` 与 `events(route)`，然后 `send(route, message)`。
7. 原样上传 delivery observations；不把 `queued` 升级为 `processed`。
8. 收到正式 reply 后重新 replay/readSince，使用最新 cursor
   `appendInteraction({ type: "pong", message: reply, ... })`。
9. pong append 成功后发布 `reply.recorded`。若 prefix 已变，先读取 delta 并协调；
   不能覆盖、重置或把 stale reply 追加到错误会话。

`ping` 已记录而 send 尚未开始是可恢复但不能盲目继续的状态：操作者先观察 session
和项目 log，再显式选择恢复 send 或保留 pending goal。send 已调用但结果 uncertain
时禁止自动 resend。`pong` 和 final reply 都不表示完成，也不移除更早消息；若 reply
超过 Silvermoon event record 的 byte limit，保留 `reply.observed` 并明确进入
`reconciliation.required`，不能截断后标记 `reply.recorded`。

## Human decisions

Review action 独立于 interaction endpoint。请求至少绑定：

```text
POST /v1/clients/{clientId}/projects/{projectId}/ideas/{ideaId}/decisions
```

请求 body 至少包含：

```json
{
  "decisionId": "0199...",
  "type": "acceptIdeal",
  "worldRevision": "fb661bed748013dfd32d111e42974dbfed7d003b",
  "expectedEventLog": {
    "length": 512,
    "digest": "409b76089b860749160c1e1de91f03809359a2d7"
  },
  "expectedPrimary": "daed9052bb5442518d887676ec86dc892d7b8f66"
}
```

Relay 只能在 UI 已获得该 exact revision 的显式人类决定后建立请求。connector 重新
运行 `next/replay`、refresh primary，并通过项目版本的受控 event append 写入对应
decision。revision、prefix 或 primary 改变时返回 stale decision，不重放旧授权。
`acceptIdeal`、`acceptInner`、`acceptOuter`、`abandon` 与 `resume` 不得经
`appendInteraction`，也不能由 Agent reply 触发。

## Client connector WebSocket

正式握手使用 `GET /v1/clients/{clientId}/connect`、connection token 和
`X-Silvermoon-Client-Id`。path 与 header 中的 ID 必须完全一致，否则返回
`400 ambiguous-client-identity`；token 也必须属于该 client。第一条 connector 消息是
`client.hello`，包含协议版本、connection ID、connector metadata、capabilities 和
relay observation resume cursor。Relay 以 `relay.welcome` 返回 connection
generation、lease 与 heartbeat 参数。

### Relay 到 connector

- `route.next.request`
- `route.events.request`
- `interaction.append-and-send`
- `decision.append`
- `route.reconcile`
- `relay.ping`

每个命令有稳定 `commandId`、route、必要 exact preconditions 和 payload hash。
Relay 可重发未取得 durable receipt 的命令；connector 必须按 `commandId` 幂等，
相同 ID 不同 payload 产生 protocol conflict。

### Connector 到 relay

- `command.recorded`：命令已写入 connector durable inbox，不代表执行完成；
- `runtime.result`：经过 schema 验证的 ProjectRuntime structured result；
- `interaction.appended`：ping/pong append structured receipt；
- `delivery.observed`
- `session.observed`
- `activity.observed`
- `reply.observed`
- `decision.appended`
- `reconciliation.required`
- `client.pong`

每条消息绑定握手的 user/client/token/generation。route 必须存在于该 client 公布的
registry projection；消息自报 identity 不扩大授权。

## 持久化与恢复

- D1 保存 user/client/project registry projection、route envelope、interaction
  idempotency、relay observation stream 和 decision request metadata。
- 每 client Durable Object 协调 connector generation、command outbox、durable
  receipt、observation order、lease 和 backpressure。
- connector 本地 registry/session binding/project Git/event log 是 route execution
  与 Silvermoon business truth 的权威；relay D1 不是它们的副本权威。
- DO 与 D1 不存在跨存储原子事务，使用 durable outbox/inbox、stable command ID 和
  compare-and-set cursor 对账部分失败。
- connector shutdown 不删除 Copilot session history 或 worktree。`recover` 要求确认
  旧 owner 已停止；`forgetSession` 要求确认 session 已丢失；两者均不授权 resend。

## 错误与安全

统一错误包含稳定 `code`、human `message`、`retryable`、安全的 `details` 和 relay
`requestId`。至少覆盖：

- authentication/origin/CSRF/ownership；
- unknown client/project/idea route；
- unsupported Silvermoon/report/event protocol；
- event prefix conflict、stale decision、primary moved；
- interaction/command idempotency conflict；
- route owner/session binding conflict；
- delivery unknown、session gone、reconciliation required；
- rate、capacity、payload、backpressure 与暂时内部失败。

消息、report、activity 和 tool details 都可能包含私密代码或 secrets。普通日志只记录
稳定 ID、route hash、类型、字节数、耗时和结果 code。tool details 默认不跨 relay；
显式开启时也必须做大小限制、访问控制、短期保留和禁止普通日志。

## 机器可读契约与兼容

- `packages/protocol` 提供 runtime schema 与 TypeScript 类型，但不得重新定义
  Silvermoon structured report 或 event receipt 的业务语义。
- OpenAPI 3.1 描述 browser HTTP、SSE 和错误；AsyncAPI 描述 connector WSS 的方向、
  command、observation 和 close code。
- CI 用 pinned Silvermoon 版本验证 reports/receipts fixtures，并验证文档示例、共享
  schema、Worker route 与 connector contract 不漂移。
- `/v1/daemon/connect`、`X-Silvermoon-Daemon-Id`、`task.submit` 和 `/v1/tasks`
  只属于旧脚手架兼容/移除清单，不进入正式 API。旧连接入口映射到 canonical
  `/v1/clients/{clientId}/connect`；已有数据通过 migration 保留 identity 与 token
  ownership，但不把旧 task rows 转换成虚构 Silvermoon interactions。
