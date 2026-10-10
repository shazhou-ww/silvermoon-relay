# 多 Client 聚合的 Agent-like Relay Stream

## 意图

把用户拥有的多路 Silvermoon clients 汇聚成一条 agent-like 双向消息流：上游像与
一个 Agent 对话一样发送消息，Relay 将消息广播给该流的所有 client，并把各 client
产生的回复、活动和状态按因果关系合并回同一条流。

## 背景

仓库已经具备用户登录、connection token、client connector WebSocket 的基础，但当前
脚手架仍以单 daemon 连接和 task request 为中心。此前的 API 设计又进一步暴露了
Silvermoon project/idea 操作，这让 Relay 过度理解下游业务。

Relay 的核心不应是 task service 或远程 Silvermoon CLI，而是一个多 endpoint 的消息
fabric：

- 上游只有一条稳定、双向、agent-like stream；
- 多个 client 同时加入该 stream；
- 上游消息一次登记后广播给所有成员 client；
- client 消息汇聚到同一 stream，保留来源与因果关系；
- 断线 endpoint 从自己的已处理前沿恢复，不依赖 WebSocket frame 是否发出；
- discovery、project/idea inventory 和 presence 只是辅助 control plane。

`causal-weave@0.1.0` 提供的多 endpoint causal channel 与这一模型吻合。它用内容寻址
消息、endpoint frontier、原子 sequence CAS、`send/read/getState/watch` 和显式
uncertain outcome 建立可靠消息历史；但它不提供 channel identity、认证、网络广播、
consumer acknowledgment、payload schema、保留策略或具体持久化 adapter。这些仍由
Relay 负责。

Silvermoon 是 client 可以承载的一种业务能力，而不是 Relay transport model。某条
消息可以携带 `IdeaRoute` context，client 可以用自己的 `ProjectRuntime` 和
`AgentAdapter` 处理，但 Relay 不复制 lifecycle reducer、不代写 `ping/pong` 或 human
decision，也不把 Silvermoon report 变成 transport 状态。

## 期望结果

- 用户可以创建一条 aggregate stream，并显式选择一个或多个自己拥有的 member
  clients；也可以选择“当前全部 clients”，服务端在创建时展开为不可歧义的 member
  snapshot。
- 每条 stream 对上游呈现一个 agent-like 双向接口。上游消息默认广播给该 stream 的
  所有 member clients；每个 client 的输出进入同一条上游消息流，并携带稳定
  `sourceClientId`。
- 每条 stream 内部使用一个独立 `causal-weave` Channel。上游 writer 和每个 member
  client 都拥有不可伪造的 endpoint ID；endpoint ID 由 Relay 根据认证上下文分配，
  不信任消息自报值。
- 消息以 `(streamId, hash)` 作为公开稳定 identity。`hash` 覆盖 endpoint、发送
  frontier、content type 与 content，但不包含 channel ID；因此 hash 不能脱离
  `streamId` 被解释为全局唯一消息。
- 每个 endpoint 发送消息时声明自己实际处理到的 causal frontier。Relay 不用全局
  latest frontier 替 endpoint 伪造观察，也不按时间戳或 sequence 猜测因果关系。
- `causal-weave.send` 成功只表示消息已经原子登记到 stream history。Relay 随后通过
  watch/notification 唤醒所有成员，并让每个 consumer 用自己的 frontier `read` 未见
  消息；登记、WebSocket 发送、consumer 收到和业务处理是四个不同事实。
- 每个 consumer 仅在成功处理一页消息后提交其 `nextFrontier`。断线后从持久化的
  consumer frontier 恢复；`hasMore=false` 只表示当前读取边界已追平，不表示 stream
  永久完成。
- 精确重投同一个 causal message 返回原 hash/sequence，不重复广播为新事实。
  `CONCURRENT_MODIFICATION` 要求重新读取并显式协调；`APPEND_OUTCOME_UNKNOWN`
  要求用原消息/hash 核实，不能改变 frontier 或 content 后盲重发。
- Relay 使用 `causal-weave.read` 生成有界、有序 message pages，并用 WebSocket
  credit/ack 控制每个 endpoint 的 in-flight page。慢 consumer 只阻塞自己的 delivery，
  不阻塞 channel 登记或其他 endpoints。
- client 可以离线后补读 stream history。成员资格、撤销、stream close 与 retention
  是 Relay control facts，不写成假的 causal message；已经登记的 causal history 在
  stream 保留期内不可改写或局部删除。
- 多个 client 的消息按 channel registration sequence 提供稳定读取顺序，同时向上游
  暴露 causal frontier。sequence 不是 wall-clock 顺序或因果证明，UI 不以 sequence
  替代 frontier。
- 上游看到的是一条统一的 Agent event stream，包括 client-scoped reply、activity、
  tool/session observation 和结构化错误。Relay 不把中间 activity 升级为 final reply，
  也不把任一 client 的 idle 推导为整个 aggregate stream 完成。
- 对 Silvermoon-aware 消息，payload 可以携带 canonical project/idea context 和
  agent interaction；具体 `ping/pong`、ProjectRuntime report、human decision 与恢复
  逻辑由取得 route ownership 的 client 执行并以普通 stream message 回报。Relay
  transport 不理解或修改这些事实。
- client/project/idea discovery API 用于选择 stream members、查看能力与诊断当前
  topology；它们不是消息发送的主路径。正式 interaction、reply 和 activity 全部经过
  aggregate stream。
- 每个用户由一个 Durable Object relay hub 协调上游连接、client connections、stream
  membership、fan-out、backpressure 和 hibernation。每条 stream 的 causal history
  使用 DO SQLite 中独立的 `PersistenceStrategy` namespace；D1 保存账户级 discovery
  与可查询元数据。
- `causal-weave@0.1.0` 作为精确固定的 runtime dependency 使用。实现前以 Cloudflare
  Worker 测试证明其 ESM、Web Crypto、TextEncoder/TextDecoder 和零 Node import
  路径兼容；版本升级必须重新审核 pre-1.0 contract。
- OpenAPI 描述 stream/discovery control plane，AsyncAPI 描述 upstream 与 client
  WebSocket 数据面；共享 runtime schema 验证 application envelope，并与
  `causal-weave` 的 binary message codec/limits 保持明确边界。

## 范围

### 范围内

- Aggregate stream 的创建、读取、关闭、membership snapshot 和上游 agent-like
  WebSocket。
- client connector WebSocket、多 stream subscription、广播 fan-out、汇聚、resume、
  credit、ack 与 backpressure。
- `causal-weave@0.1.0` Channel 集成和 Cloudflare Durable Object SQLite
  `PersistenceStrategy`。
- authenticated endpoint ID、message envelope、content type、stream-scoped hash、
  causal frontier 与精确重投。
- 每 consumer 的 durable processed frontier，以及 disconnect/hibernation 恢复。
- client presence/capability 和嵌套 project/idea inventory 的只读 observability API。
- Agent-like user message、reply、activity、tool/session observation、error 和可选
  Silvermoon context 的 application schema。
- stream 容量、历史上限、整流关闭、完整 stream retention/expiry 和新 stream
  rollover。
- 旧 daemon/task/Silvermoon-operation-first 协议向 stream-first 模型的迁移与移除。

### 范围外

- 通用 task queue、job status、调度器、优先级、cron、batch 或自动执行重试。
- 把 `/clients/{clientId}/projects/.../ideas/...` 作为 interaction 主路径；这些只用于
  inventory 与 diagnostics。
- Relay 直接执行 Silvermoon CLI、读写 project Git、复制 lifecycle reducer 或推断
  approval/acceptance/abandonment。
- Relay 保证某条广播只被一个 client 执行。默认语义是所有 stream members 都收到；
  需要单 owner 的业务操作必须由 application protocol 的 route claim/lease 明确协调。
- 以 WebSocket 发送成功、causal registration、consumer ack 或 Agent idle 推导业务
  已完成。
- 跨用户 stream、公共聊天室、匿名 endpoint、组织 ACL 和任意第三方 endpoint federation。
- 对任意外部 tool side effect 提供 exactly-once；causal message 登记幂等不等于业务
  副作用幂等。
- 在单条无限历史上做局部删除或 GC。`causal-weave@0.1.0` 是不可变历史模型，达到
  明确上限后关闭旧 stream 并创建新 stream。

## 约束

- 生产只使用 HTTPS/WSS。上游使用 hardened browser session 或未来明确授权的
  credential；client connector 使用 connection token。凭据不进入 URL、payload、
  causal content 或普通日志。
- Stream membership 在 v1 创建时成为不可变 snapshot；不能把瞬时 online clients
  静默解释为成员集合，也不能把后注册的 client 自动加入旧 stream。需要不同成员时
  关闭旧 stream 并创建新 stream。撤销 client/token 仍会立即阻止连接与 delivery，
  但不改写旧 stream 的历史成员事实。
- 同一个 causal endpoint 同时只有一个活动 writer generation。新连接恢复成功后才可
  替换旧连接；并发 writer 会形成 fork 风险，必须在进入 Channel 前拒绝。
- Relay 只接受认证 endpoint 对应的 `endpointId`。content 内的 client/user/endpoint
  字段是 application data，不能扩大权限或改变 causal sender。
- Frontier 必须闭合、引用当前 stream 内已登记消息，并保持本 endpoint tip 与已观察
  维度不回退。Relay 原样暴露 `STALE_ENDPOINT_TIP`、`OBSERVATION_REGRESSION`、
  `FRONTIER_NOT_CLOSED` 等可操作错误。
- 每条 stream 的 persistence adapter 必须兑现 `causal-weave` contract：绑定唯一
  channel、统一原子 sequence CAS、完整强一致范围扫描、不可变记录、结果不确定与确定
  未写入分离，以及 watch failure 显式上报。
- DO SQLite schema 必须持久化规范 message bytes/hash、sequence 与查询 frontier 所需
  数据。adapter 返回值需能被 Channel 重新编码核验，不能只保存 application payload。
- `watch` 只是变化通知。所有网络 fan-out 都以 `read({ after, limit })` 结果为准；
  notification 可以合并或丢失，重连仍能从 frontier 找回全部未处理消息。
- Consumer ack 表示 Relay endpoint 已成功处理到 frontier，只推进该 consumer cursor；
  它不是业务完成、审批、认知或回复证明。
- Application envelope 有独立且低于 causal-weave 默认 1 MiB 的生产上限；超限显式
  失败，不截断为成功。历史节点、frontier 维度、单页消息与读取成本设置有界 profile。
- 单条 stream 在达到 message/byte/age 任一上限前进入 draining，停止新 publish，
  允许 members 追平后关闭。新 stream 不伪造跨 channel causal frontier。
- route-specific mutating message 被广播给多个 clients 时，只有持有 route ownership
  lease 的 client 可以执行；其他 clients 只能观察或报告 not-owner。lease 是
  application coordination，不写入或改写 causal history。
- 普通日志不记录 content、frontier 全量、token、cookie、源码或 tool details，只记录
  user/stream/client/message 的安全 ID、大小、耗时和结果 code。
