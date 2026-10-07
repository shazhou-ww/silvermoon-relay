# 正式 Relay API 与任务投递协议

## 意图

为 `silvermoon.work` Web 客户端和 Silvermoon daemon 定义并实现可版本化、可恢复、
可观测的正式 relay API，使用户能够向自己的在线或暂时离线 daemon 提交任务，
可靠观察投递与执行进展，并取得 Agent 的最终回复，而不把任一传输确认误报为任务
已经处理。

## 背景

仓库已经具备 OAuth 登录、浏览器 session、connection token、daemon WebSocket
入口、每 daemon 一个 Durable Object，以及最小的共享协议类型。现有协议仅能完成
连接握手；`task.submit`、`request.accepted` 和 `request.rejected` 仍是未接线的
占位类型，Web 端也没有正式的 daemon 列表、任务提交、状态恢复或回复流。

Relay 横跨三个不同的事实边界：

1. HTTP 请求被 relay 持久接收；
2. 任务被目标 daemon 的持久 inbox 接收；
3. daemon 上的 Agent 实际运行并产生可观察活动或最终回复。

这些事实可能因断线、超时和重试而分别成功、失败或未知。API 必须显式表达这种
不确定性，并使用幂等键、单调事件序列和游标恢复，避免重复执行或伪造成功状态。
详细 wire contract 由同一 Ideal World 下的
`Relay-API-Contract.md` 补充定义；本文件仍是该 idea 的 canonical ideal contract。

## 期望结果

- 已登录用户可以通过版本化 HTTP API 列出自己拥有的 daemon，看到稳定 daemon
  ID、展示名、能力、最后在线时间和当前连接状态；不存在或属于其他用户的资源使用
  不可枚举的响应语义。
- 用户可以提交一个包含客户端生成 UUID `requestId`、目标 `daemonId` 和非空
  `prompt` 的任务。Relay 在返回 `202 Accepted` 前先持久化任务和初始事件；相同
  用户以相同 `requestId` 和相同规范化 payload 重试时得到同一任务，不会重复投递，
  payload 不同则得到明确冲突。
- 任务公开状态至少分为 `delivery` 与 `execution` 两个正交维度。Relay 接收、发送
  WebSocket frame、daemon 持久接收、Agent 开始运行和最终回复分别形成不同事件；
  任一较早事实都不能推导较晚事实。
- 用户可以读取任务当前投影和有序事件历史，并通过带序列游标的 Server-Sent Events
  流等待增量。断线后客户端使用 `Last-Event-ID` 或 `after` 游标无损续传；慢消费者
  或过旧游标收到明确的可恢复错误，而不是静默跳过事件。
- daemon WSS 协议支持连接协商、能力声明、任务投递、持久接收确认、拒绝、活动
  观察、最终回复、失败和重连恢复。所有消息包含协议版本以及足够的 task/request/
  event 标识；未知消息与不支持版本以结构化错误失败。
- Relay 对 daemon 采用至少一次投递，对单个任务采用幂等处理。daemon 必须先把任务
  写入本地持久 inbox，再发送 `delivery.accepted`；relay 在确认前重发同一 task 不得
  启动第二次 Agent 执行。
- daemon 重连时携带最后确认的 relay 投递游标和最后上传的事件游标，双方通过显式
  resume 交换补齐缺口。连接中断或 send acknowledgment 不足以证明对端消费，结果
  保持 `unknown` 直到权威事件澄清。
- 每个任务事件拥有由 relay 分配、从 1 单调递增且不可改写的 `sequence`；事件写入与
  当前任务投影在同一权威边界内原子推进。重复的 daemon 事件通过稳定 `eventId`
  去重，相同 ID 不同 payload 被拒绝并记录协议冲突。
- D1 保存跨连接可查询的 daemon、任务、事件投影与幂等元数据；对应 daemon 的
  Durable Object 协调活动连接、投递队列、游标和顺序。两者的权威职责、失败恢复和
  对账路径明确，不依赖仅存于 isolate 内存的状态。
- HTTP 与 WebSocket 都使用统一、稳定、机器可判断的错误 code，并带相关
  `requestId`；错误不得回显 token、cookie、完整 prompt、Agent 私密输出或内部异常。
- 正式契约提供由共享运行时 schema 验证的 TypeScript 类型，并提交一致的 OpenAPI
  3.1（HTTP/SSE）与 AsyncAPI（daemon WSS）描述。兼容性测试证明文档示例、客户端和
  Worker 使用同一消息边界。
- API 具备所有权校验、输入大小限制、速率限制、背压、审计型结构化日志和
  `Cache-Control: no-store`。用户输入和 Agent 输出按敏感内容处理，不进入普通日志
  或未授权的分析系统。
- Web 应用使用正式 API 提供 daemon 选择、任务提交、投递/执行状态、可恢复活动流和
  最终回复界面；刷新页面后从服务端投影恢复，不用前端内存伪造状态。

## 范围

### 范围内

- 浏览器 session 授权的 `/v1/daemons`、`/v1/tasks`、单任务读取和任务事件流。
- daemon connection token 授权的 `/v1/daemon/connect` 正式 WSS 子协议。
- daemon 能力协商、连接替换策略、心跳/租约、断线重连、游标恢复和协议错误。
- 任务持久接收、幂等提交、至少一次投递、daemon 持久接收确认与重复抑制。
- 投递状态、执行状态、活动观察、最终回复和失败事件的持久模型。
- D1 migration、Durable Object SQLite 状态、共享 Zod schema、OpenAPI、
  AsyncAPI、契约/集成/恢复测试。
- Web 端 daemon 与任务的最小可用流程，以及相关可访问性和错误状态。
- 对现有 `/api/*` 身份与 token 管理接口的兼容；只在共享错误/CORS 基础设施需要时
  做向后兼容调整。

### 范围外

- 面向第三方机器客户端的通用 API key、OAuth scope 或公开开发者平台；本阶段 HTTP
  任务 API 仅供已登录的第一方 Web 客户端使用。
- 多用户共享 daemon、组织/角色权限、管理员读取任务内容或跨用户任务搜索。
- 定时任务、优先级队列、批量任务、附件/文件上传、语音、多模态输入和计费配额。
- 对已开始任务的强制取消。取消的副作用与 Agent 能力需要独立契约，不能用关闭
  WebSocket 模拟。
- token-by-token 模型输出流。正式事件流只传递有界活动摘要和最终 Agent 回复。
- 自动重试失败的 Agent 执行、跨 daemon 调度、daemon 迁移或高可用执行副本。
- Silvermoon 项目 lifecycle 决策的远程代行。Relay 传输观察和回复，不推断或自动
  记录 ideal approval、implementation acceptance 或 deployment acceptance。
- 无限期完整消息归档、全文搜索、导出、删除/保留策略产品化；首版仅建立明确的默认
  保留上限和后续清理边界。

## 约束

- 生产仅使用 HTTPS/WSS。浏览器继续使用 hardened session cookie、允许 Origin 和
  CSRF 证明；daemon token 仅通过 `Authorization` 握手头传递，绝不进入 URL。
- HTTP API 使用 `/v1` 资源路径，daemon WSS 使用显式版本协商。协议 v1 内只能做
  向后兼容的可选字段扩展；破坏性消息或状态语义必须提升 major version。
- `requestId` 在用户范围内唯一，`taskId` 由 relay 生成且不可猜测。所有时间使用
  UTC RFC 3339；所有游标为 opaque 或严格单调整数，客户端不得解析内部数据库键。
- `prompt` 首版 UTF-8 上限 32 KiB；单个活动摘要和最终回复必须有独立上限。超限在
  权威写入前拒绝，不能截断后声称成功。
- `202 Accepted` 只表示 relay 已持久接收；WebSocket frame 成功发送只表示 relay
  尝试投递；只有 daemon 的持久确认才能进入 `accepted`，只有正式 final reply
  事件才能进入 `completed`。
- SSE 只暴露当前用户拥有任务的事件，不接受 token query parameter；代理缓冲、
  keepalive、连接上限和重连退避必须适配 Cloudflare Workers 限制。
- 单个 daemon 同时只有一个活动连接 generation。新连接经过 resume 协商后替换旧
  连接；旧 generation 后续消息被拒绝，防止分区连接并发推进同一任务。
- 事件采用追加式模型；修正通过新事件表达，不原地改写历史。面向 Web 的投影可重建，
  且重建结果必须与在线更新一致。
- Durable Object 与 D1 之间不能宣称跨存储原子事务。实现必须使用可重放 outbox/
  inbox、幂等写入和对账来处理部分失败，并测试每个持久化边界的崩溃恢复。
- 任务内容、活动和回复按用户私密数据处理；日志只记录稳定 ID、事件类型、耗时、
  大小和结果 code。生产观测不得记录 bearer token、cookie 或消息正文。
- 默认保留期、速率与并发上限必须成为集中配置并在 API 中返回稳定错误；首版数值可在
  实施阶段根据 Cloudflare 限制确定，但不能以无限制作为默认行为。
- 实现必须保持现有 OAuth、session、token 轮换/撤销和 daemon 所有权约束；撤销
  connection token 后，对应 WSS 仍须立即关闭且不能继续提交事件。
