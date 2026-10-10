# Aggregate Relay Stream v1 补充契约

本文补充 `Idea.md` 的 wire-level 设计。若冲突，以 `Idea.md` 为准。核心数据面是多
endpoint causal stream；client/project/idea API 是辅助 control plane。

## 拓扑

每个用户映射到一个 Relay Hub Durable Object。Hub 同时持有：

- 一个或多个 upstream agent-like WebSocket；
- 用户拥有的 client connector WebSockets；
- 多条 aggregate streams；
- 每条 stream 的固定 member client snapshot；
- 每 endpoint、每 stream 的 processed frontier 与 in-flight credit。

每条 aggregate stream 创建一个逻辑 `causal-weave` Channel。上游 writer 是一个
endpoint，每个 member client 是一个 endpoint。所有成功登记的消息属于同一 causal
history；上游消息广播给所有 member clients，client 消息汇聚并广播给上游及其他
members，使每个 endpoint 都可以形成真实闭合 frontier。

## Control plane HTTP

### Client observability

```text
GET /v1/clients
GET /v1/clients/{clientId}
GET /v1/clients/{clientId}/projects
GET /v1/clients/{clientId}/projects/{projectId}/ideas
```

这些 API 返回 presence、capabilities 和 client 自己公布的 inventory observation。
它们用于选择 stream members 与诊断，不用于发送 Agent interaction。

### Stream lifecycle

```text
POST /v1/streams
GET /v1/streams/{streamId}
GET /v1/streams/{streamId}/messages
POST /v1/streams/{streamId}/close
GET /v1/streams/{streamId}/connect
```

`POST /v1/streams` 请求：

```json
{
  "memberClientIds": ["client-01", "client-02"],
  "label": "My aggregate agent",
  "context": {
    "projectId": "project-01",
    "ideaId": "01M4A0NV95NFGRQRJJNPR7W417"
  }
}
```

`memberClientIds` 是创建时展开的明确 snapshot，不能为空、重复或包含 foreign client。
`context` 只是提供给 application messages 的默认 hint，不改变 channel identity，也
不要求所有 members 拥有该 route。

成功响应：

```json
{
  "stream": {
    "id": "stream-01",
    "state": "open",
    "generation": 1,
    "memberClientIds": ["client-01", "client-02"],
    "currentFrontier": [],
    "createdAt": "2026-10-07T02:30:00Z"
  },
  "requestId": "0199..."
}
```

`GET .../messages` 是诊断/恢复读取接口，使用 base64url 编码的 canonical frontier 和
有界 page limit。普通实时消费使用 WebSocket page/ack protocol。

`close` 是幂等 control operation。进入 `draining` 后拒绝新 publish，等待各 endpoint
追平或到达 deadline，再进入 `closed`。关闭不删除 causal history。

## WebSocket endpoints

### Upstream agent-like stream

```text
GET /v1/streams/{streamId}/connect
```

上游连接以 browser session 或明确的 stream credential 鉴权。一个 stream 同时只有
一个活动 upstream writer generation；额外只读 observers 必须声明 observer mode，
不能使用 writer endpoint ID。

### Client connector

```text
GET /v1/clients/{clientId}/connect
```

client 使用 connection token；path、header identity 与 token owner 必须一致。一个
connector socket 可以承载该 client 所属的多条 streams，每个 frame 都含 `streamId`。

两类连接都先发送 `hello`，声明协议版本、connection generation、每条 stream 最后
durably processed frontier 与可用 receive credit。Relay 返回 `welcome`、authoritative
membership、accepted generation 和需要 reconcile 的 streams。

## Causal message

网络 JSON 表示：

```json
{
  "streamId": "stream-01",
  "endpointId": "client:client-01",
  "frontier": [
    ["upstream", "64-lowercase-hex"],
    ["client:client-01", "64-lowercase-hex"]
  ],
  "contentType": "application/vnd.silvermoon-relay.agent-event+json;v=1",
  "content": "base64url-bytes"
}
```

Relay 根据认证上下文覆盖/验证 `endpointId`，将 frontier 转成
`ReadonlyMap<EndpointId, MessageHash>`，再调用 `channel.send`。成功 receipt 返回：

```json
{
  "type": "message.registered",
  "streamId": "stream-01",
  "messageId": {
    "streamId": "stream-01",
    "hash": "64-lowercase-hex"
  },
  "sequence": 42,
  "currentFrontier": [
    ["client:client-01", "64-lowercase-hex"]
  ]
}
```

`messageId` 必须包含 stream ID，因为 causal-weave hash 不覆盖 channel。`sequence`
只用于同 channel 的稳定分页顺序，不代替 causal frontier。receipt 的
`currentFrontier` 是 Channel 在登记时看到的整体 tip projection，可能包含发送者并未
处理的其他 endpoint 消息，因此不能直接保存为该 sender 的 processed frontier。

## Broadcast 与读取

Channel `watch` 通知 Hub 某 stream 发生变化。Hub 不把通知本身当消息，而是为每个有
credit 的 endpoint 调用：

```ts
channel.read({ after: processedFrontier, limit })
```

然后发送：

```json
{
  "type": "messages.page",
  "streamId": "stream-01",
  "pageId": "opaque-id",
  "messages": [],
  "nextFrontier": [],
  "hasMore": false
}
```

consumer 成功处理整页后发送 `messages.ack { streamId, pageId,
processedFrontier: nextFrontier }`。Hub 只在 ack 与原 page 完全匹配时持久推进该
consumer frontier 并释放 credit。部分处理不能推进整页 frontier；实现可用更小 page
而不是接受消息级跳跃 ack。

notification 丢失、DO hibernation 或 WebSocket 断线都不丢消息，因为恢复以 durable
processed frontier 重新 read。slow consumer 不影响其他 consumer。

发送者也会在自己的 read 中看到已登记消息。Hub 可以在 receipt 后把该消息的发送
frontier 加上发送 endpoint 的新 hash，形成 self-processed frontier 并持久化；不能
直接采用 receipt 的整体 `currentFrontier`，因为其中可能包含发送者没有处理的其他
endpoint tips，也不能仅在内存中跳过 self message。

## Application envelope

首版 content type 定义以下 agent-like event union：

- `user.message`：上游输入，默认广播给所有 members；
- `agent.reply`：client 的正式面向用户回复；
- `agent.activity`：非最终 activity 摘要；
- `agent.session`：`running | idle | gone | unknown` observation；
- `agent.tool`：默认只含 name、call ID 与 started/succeeded/failed；
- `client.error`：稳定、脱敏、可归因到 client 的错误；
- `delivery.observation`：只表达 client/adapter 看见的 transport boundary；
- `silvermoon.report`：可选 structured four-projection report；
- `silvermoon.interaction`：可选 project event interaction observation；
- `route.claim` / `route.release`：需要单 owner 的 route coordination。

所有 envelope 含 application `eventId`、发生方、可选 `inReplyTo` 与可选
`context { projectId, ideaId }`。`eventId` 方便 application dedupe，但 causal
registration identity 仍是 `(streamId, hash)`。

Relay 验证 envelope schema 和 sender 可发送的 event type，但不解释 Silvermoon
lifecycle。`agent.activity`、session idle、delivery observation、consumer ack 和
message registration 都不能替代 `agent.reply` 或 human decision。

## Silvermoon client mapping

收到含 idea context 的 `user.message` 后，每个 member 都能观察该消息。只有拥有
对应 registered project/idea 且取得 route claim 的 client 可以执行 mutating Agent
interaction；其他 clients 发出 capability/not-owner observation。

owner client 在本机负责：

1. 用项目自身 Silvermoon runtime 观察 `whats-next` 与 event cursor；
2. 按 Silvermoon contract 追加 `ping`；
3. 驱动 AgentAdapter 并产生 session/activity/reply observations；
4. 用准确 cursor 追加 `pong`；
5. 把 structured results 作为 stream messages 发送。

Relay 不把 causal frontier 转换成 Silvermoon `{length,digest}`，也不反向转换。两个
cursor 各自证明不同边界，仅在 application envelope 中关联。

## `causal-weave@0.1.0` 集成边界

直接使用：

- `createChannel({ persistence, limits })`
- `send` 的内容寻址、frontier validation、tip/fork/regression 检查与 CAS receipt；
- `read` 的 causal continuation、stable sequence page、`nextFrontier` 与 `hasMore`；
- `getState` 的 stream current frontier；
- `watch` 的变化 notification；
- exported Result/error unions、codec、hash 和 limits。

Relay 必须实现：

- stream/channel ID、user/client authorization 和 endpoint assignment；
- DO SQLite `PersistenceStrategy`；
- WebSocket fan-out、consumer cursor、credit/ack 和 reconnect；
- application envelope schema、membership、route claim 和 retention；
- metrics、redaction、capacity 与 operational recovery。

不得假设包提供：

- network delivery、consumer processing proof 或 per-consumer offset；
- channel/global hash namespace；
- payload JSON/MIME validation；
- history GC、snapshot、distributed consensus 或 business exactly-once；
- Silvermoon lifecycle 或 Agent semantics。

包固定为 exact `0.1.0`。它声明 Node.js 22+，但发布产物运行时零依赖且只使用标准
ESM、Web Crypto、TextEncoder/TextDecoder、Map 和 typed arrays；采用前必须在
Cloudflare Worker/Vitest pool 中运行真实 send/read/watch/codec/persistence contract
测试，而不是只依赖静态代码检查。

## Durable Object persistence

每个用户 Hub DO 的 SQLite 以 `stream_id` 分区，至少保存：

- stream metadata、generation、state 与 member snapshot；
- causal messages 的 sequence、hash、endpoint、canonical encoded bytes；
- endpoint tip/frontier 所需索引；
- consumer processed frontier、pending page/credit 与 connection generation；
- idempotent control operations、route leases 和 close/drain state。

每个 stream adapter 必须把所有 causal-weave persistence calls 限定到一个
`stream_id`。`append` 在单个 SQLite transaction 中比较最新 sequence、插入不可变
record 并推进 high-water mark；冲突返回 `SEQUENCE_CONFLICT`。storage failure 必须
区分确定未写入与 `APPEND_OUTCOME_UNKNOWN`。

D1 只保存跨连接查询所需的 user/client/presence/inventory 与 stream summary。D1
projection 落后不影响 DO causal truth，且不能用于生成 frontier。

## 错误与容量

API 原样映射稳定 causal-weave errors，并补充 auth、membership、generation、
credit、stream state、schema 和 route lease errors。错误不包含 content。

单条 stream 设置低于包 hard limits 的 production profile，包括 message bytes、
frontier endpoints、page messages/bytes、history nodes、node reads、age 和 total
bytes。接近任一上限时进入 draining 并要求创建新 stream；不得跳过历史验证、截断
content、删除中间 nodes 或跨 stream 伪造 frontier。

## 旧协议迁移

- `/v1/daemon/connect` 与 `task.submit` 不进入正式 API。
- 旧 connection token 可迁移为 client connector token，但 token owner 与 client ID
  必须保持一致。
- 旧 task rows 不转换成 causal messages，因为它们没有可信 endpoint/frontier。
- 旧 per-daemon Durable Object 不作为 aggregate truth；新架构迁移到 per-user Hub
  DO，并在切换前验证没有双 writer。
