# 正式 Relay API 与 Silvermoon 交互协议

## 意图

为 `silvermoon.work` Web 应用和 Silvermoon client 定义可版本化、可恢复、可观测的
正式 relay API，使用户能够基于明确的 Silvermoon project/idea route 与远端 Agent
继续交互，同时保持项目仓库、Silvermoon CLI 和显式人类决定作为唯一业务权威。

## 背景

仓库已经具备 OAuth 登录、浏览器 session、connection token、daemon connector
使用的 WebSocket 入口、按现有 daemon identity 分片的 Durable Object，以及最小的
共享协议类型。当前协议中的 `task.submit`、`request.accepted` 和
`request.rejected` 是通用任务队列占位，和 Silvermoon 的业务模型不一致。

Silvermoon 的持续工作单位不是 relay task，而是由 canonical credential-free
`projectUrl` 与 canonical `ideaId` 组成的 `IdeaRoute`。项目自己的 Silvermoon
进程通过 `whats-next` 决定下一步；三个嵌套 world 的 Git tree revision 和显式人类
决定派生 lifecycle。v2 项目的 `events/` 是持久状态权威，其中 `ping` 是 upstream
消息，`pong` 是 downstream 消息；它们不代表完成，也不清除更早目标。

Agent adapter 的 delivery、session、activity 和 final reply 都只是观察：

- SDK 接受 send 只能产生 `queued`，随后在没有逐消息消费证据时必须是 `unknown`；
- session 只有 `running | idle | gone | unknown`，不能映射成 idea lifecycle；
- activity/tool events 不是正式 Agent reply；
- final reply 是 Agent idle 时最后一条面向用户的 assistant message，但也不表示
  ideal 已批准、implementation/deployment 已接受或工作已经完成。

正式 API 中，`client` 是用户可寻址并承载若干 Silvermoon routes 的逻辑端点；
`daemon` 只是当前 connector 实现。Relay 协调 transport 和 observation，不复制
Silvermoon reducer、不代写 lifecycle decision、不把自己的数据库状态提升为项目事实。
详细 wire contract 由同一 Ideal World 下的 `Relay-API-Contract.md` 补充定义。

## 期望结果

- 已登录用户可以列出自己拥有的 client，看到稳定 `clientId`、展示名、当前连接
  observation、能力和脱敏 connector 信息。daemon 仅作为 connector kind，不是公开
  资源 identity。
- 每个可交互目标使用准确 `IdeaRoute { projectUrl, ideaId }`。`projectUrl` 是
  credential-free canonical HTTPS Git remote，`ideaId` 是 canonical ULID；relay
  不从自由文本、目录名、branch 或本机路径猜测 route。
- client 只公布其 `LocalProjectRegistry` 已注册并能安全解析的 project，以及这些项目
  自己的 `silvermoon list-ideas` inventory。Relay 不下发任意本地路径，也不要求
  connector clone 未注册 repository。
- Web 用户可以选择一个 client 和 route，读取由该项目自己的 `ProjectRuntime.next`
  返回的完整结构化 Silvermoon report。Relay 透传并标记 observation provenance，
  不重新实现 `whats-next` 或从 Markdown 推导 lifecycle。
- 用户可以向 route 发送非空交互消息。connector 必须先用 `ProjectRuntime.replay`
  或 `readSince` 观察准确 event-log cursor，再用 `appendInteraction` 将 upstream
  `ping` 条件追加到项目日志，最后才把同一消息交给 Agent adapter。
- 每次交互使用调用方生成的幂等 `interactionId`。相同用户、client、route、ID 和
  payload 的重放返回原 observation；任一字段不同则明确冲突，不能再次 append 或
  send。
- `ping` 追加成功只证明项目 event log 已持久记录用户目标，不证明 SDK 已消费消息。
  SDK send 的 `queued | delivered | processed | unknown` observation 按 adapter 原样
  暴露；当前 Copilot adapter 不提供消费证据时不得伪造 `delivered` 或 `processed`。
- client 将 Agent session observation 作为独立流上传：session 状态、面向用户的
  message observation、tool started/succeeded/failed，以及被明确授权时的 tool
  details。activity 不写入 Silvermoon event log，也不成为 human decision。
- Agent adapter 产生正式 final reply 后，connector 重新观察准确 event log，并以
  最新 `{length, digest}` 条件追加同一 route 的 `pong`。`pong` 持久化成功后，relay
  才把该 reply 标记为 repository-recorded；回复本身仍不表示 lifecycle 完成，也不
  清除或替代更早的交互目标。
- 浏览器能够按 route 读取 ordered Silvermoon interaction messages、当前
  `lastSignal`、Agent session observation 和正式 replies，并通过游标流断线续传。
  Silvermoon event cursor 与 relay observation cursor 分开建模，绝不互相替代。
- lost connection、uncertain send、aborted turn、session error 或 `gone` 都停止自动
  重发。系统要求先重新观察项目日志和 session binding；恢复、forget 或 resend 必须
  是显式且可审计的动作。
- route ownership 在同一时刻只有一个活动 connector owner。connector 使用
  `LocalProjectRegistry.acquire/recover` 语义防止两个进程并发驱动同一 route；
  relay 的 lease 只是额外协调，不能替代本机 registry lock。
- 所有 Silvermoon CLI 调用通过项目自身安装的 `ProjectRuntime` 执行，并保留四个
  projections：`intention`、`observation`、`actions`、`response`。未知 CLI/report
  版本、route、event operation 或 malformed receipt 显式失败。
- 人类可以通过正式、revision-bound 的 review action 提交 approval/acceptance/
  abandonment 决定；connector 必须重新观察 exact revision、event-log cursor 和
  primary，再调用项目版本支持的受控 Silvermoon event append。Relay 不从聊天文本、
  按钮标签、Git 活动或 Agent reply 推断决定。
- Web 应用围绕 project、idea、当前 phase、canonical contract、interaction 和
  review gate 呈现体验，而不是展示通用 task queue/status。
- API 提供统一 schema、OpenAPI（HTTP/stream）和 AsyncAPI（client connector WSS），
  并对 token、cookie、repository 内容、消息和 tool details 实施所有权、大小、
  rate、backpressure、日志脱敏与明确错误边界。

## 范围

### 范围内

- 浏览器 session 授权的 client、registered project、idea route、Silvermoon report、
  interaction、observation stream 和显式 review decision API。
- connection token 授权的 `/v1/client/connect` WSS 子协议，以及 route ownership、
  capability、lease、resume 和 reconciliation。
- `ProjectRuntime.next/replay/readSince/appendInteraction` 与
  `AgentAdapter.start/observe/send/events` 的远程编排。
- upstream `ping`、downstream `pong`、exact event cursor 和 final reply 的安全关联。
- route interaction 的幂等性、uncertain delivery、session binding 和显式恢复模型。
- v2 event project 的完整支持，以及 v1 不支持 interaction append 时的明确
  unavailable response；不从其他 report 猜测兼容能力。
- revision-bound 人类决定的传输、再观察和项目本地受控写入。
- Web 端 project/idea 导航、当前 Silvermoon report、交互、Agent activity、reply 和
  review gate 的最小可用流程。
- 现有 daemon endpoint、headers、protocol types 和存储命名向 client/route/
  interaction terminology 的兼容迁移。

### 范围外

- 通用 task queue、`/v1/tasks`、relay 自定义的 queued/running/completed 业务状态、
  跨 route 调度、优先级、cron、batch 或自动执行重试。
- 在 relay 中复制 Silvermoon lifecycle reducer、world revision 算法、event grammar、
  `whats-next` 决策或项目 Git synchronization。
- Relay 直接读写用户 repository、接受本机路径、执行任意 CLI 命令或自动注册未知
  project。
- 从 Agent reply、session idle、ledger checkbox、Git push 或用户沉默推断任何人类
  decision。
- 多用户共享 client/project/idea、组织角色、管理员读取私密 repository observation。
- token-by-token 模型输出、无限 tool transcript、任意 binary attachment 或完整
  session history备份。
- 自动恢复 lost Copilot session、自动 forget binding、在 uncertain send 后自动
  resend，或对任意 tool side effect 提供 exactly-once 保证。
- 本 idea 内稳定 Silvermoon 的 experimental JavaScript API；relay 必须 pin 精确
  Silvermoon 版本并显式处理版本升级。

## 约束

- 生产仅使用 HTTPS/WSS。浏览器使用 hardened session cookie、允许 Origin 和 CSRF
  证明；connector token 仅通过 `Authorization` 握手头传递，绝不进入 URL。
- `IdeaRoute.projectUrl` 必须 canonical、credential-free 并与 project
  `.silvermoon/config.yaml` 一致；`ideaId` 必须使用 canonical ULID，不接受 alias
  作为跨边界 identity。
- Silvermoon event-log cursor 是准确 `{length, digest}`；它不是 checkpoint、
  session boundary、decision authorization 或 delivery proof。relay observation
  stream 使用独立 opaque cursor。
- 对某个 route 的 `ping` 或 `pong` 只有在 connector 返回项目
  `appendInteraction` 的成功 structured receipt 后才可标记 repository-recorded。
- 追加 interaction 前后都必须使用项目自己的 runtime 并验证 expected log prefix。
  prefix 改变时返回 conflict/reconcile-required，不能 reset cursor 或盲重试。
- decision request 必须绑定 exact world revision、完整 event prefix 和 refreshed
  primary。interaction append 不携带 expected primary；两类操作不能共用一个简化
  mutation endpoint。
- Agent send acknowledgment、WebSocket frame send、relay durable write 和
  `ping` append 分别是不同事实；API 命名与 UI 不得将它们压缩为“已处理”。
- final reply 只来自 `AgentAdapter.events` 的正式 reply stream。partial assistant
  message、tool output、idle notification 或 relay timeout 不能升级为 final reply。
- route 发生 aborted turn/session error 后 formal reply stream 失败；shutdown 为
  `gone`；后续 send 为 `unknown`。恢复前必须协调 project log、registry owner 和
  persisted session binding。
- tool details 可能包含源码、命令输出或秘密，默认能力只暴露 tool name/state；详细
  input/output 需要显式产品授权、严格大小限制和不落普通日志策略。
- Relay 可以持久化 transport envelope、幂等 key、cursor、structured reports 和
  observations，但项目 event log 与 Git worlds 始终是业务权威。缓存可丢弃重建，
  不能成为 decision 或 lifecycle 事实。
- connector 可以承载多个 client 和 routes，但每条消息都绑定握手得到的 user、
  client、token、route lease 与 connection generation；自报 identity 不扩大授权。
- 现有 `/v1/daemon/connect` 仅可作为限时兼容入口映射到 client connector，不能让
  daemon identity 继续成为 project/idea route 或公开 API resource。
- 运行时依赖 pin 到精确 Silvermoon `0.x` 版本；升级前审核 changelog、声明和 structured
  report shape，并通过兼容性测试。
