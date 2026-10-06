# Cloudflare 中继服务项目脚手架

## 意图

建立一个可在本地开发、自动验证并部署到 Cloudflare 的 TypeScript monorepo
脚手架，为 Silvermoon daemon 提供经用户 access token 认证的上游 WSS 连接，
并为用户通过 Web 前端向指定 daemon 发布任务提供清晰的扩展边界。

## 背景

Silvermoon daemon 的设计要求 daemon 主动连接 upstream，远端连接必须使用
`wss://`，token 只保存在受保护的用户级配置中，不得进入 URL、命令行、日志或
错误。现有上游协议已经区分请求的持久接收确认、下游投递观察和 idea 事件，
中继服务需要保持这些事实边界，而不能把 WebSocket 发送成功解释为任务已处理。

当前仓库只有 Silvermoon 元数据，还没有应用结构、Cloudflare 配置、测试或部署
流水线。`silvermoon.work` 已在 Cloudflare 账户中可用，Cloudflare 凭据可由本机
`cfg` 命令访问，但任何凭据值都不得写入仓库或构建日志。

## 期望结果

- 仓库是 pnpm workspace 管理的 TypeScript monorepo，至少清晰分隔 Pages
  React 前端、Worker/DO 中继后端和两端共享的版本化协议类型。
- `silvermoon.work` 提供由 React、Vite 和 shadcn components 构建的 Pages
  用户界面；后端使用独立的 `relay.silvermoon.work` HTTPS/WSS 入口，避免
  Pages 静态路由和长连接入口相互耦合。
- relay Worker 验证 daemon 提供的用户 access token 后，才按稳定 daemon
  identity 将连接路由到对应 Durable Object。每个 daemon 使用独立 DO 作为
  协调单元，不创建承载全部连接的全局单例。
- Durable Object 使用 WebSocket Hibernation API 承载长连接，并把恢复连接所需
  的关键状态先写入本地 SQLite storage；对象被回收或唤醒后不依赖易失内存恢复
  权威状态。
- D1 保存跨连接查询所需的用户、daemon 注册、任务元数据和状态投影；单个 daemon
  的连接协调、投递游标、幂等接收信息等强一致状态保存在对应 DO 本地 storage。
  D1 和 DO storage 的职责边界明确，不形成两个相互竞争的权威来源。
- 后端提供最小健康检查与经过类型约束的 WSS/HTTP 接口骨架；前端提供可访问的
  应用外壳、连接状态和 daemon/任务入口占位，足以验证前后端边界，而不伪造尚未
  实现的业务成功状态。
- 本地开发使用 Wrangler 的本地 D1 和 DO storage；类型检查、lint、测试和构建可
  由仓库根命令统一执行。
- 合并到 `release` 分支时，GitHub Actions 运行完整质量门禁，应用 D1 migrations，
  部署 Worker/DO 和 Pages 产物，并将自定义域名保持在预期服务上。部署只从 GitHub
  Actions secrets 读取最小权限的 Cloudflare API token 与 account ID。
- `main` 作为 Silvermoon primary branch 和日常集成分支保持不变；只有进入
  `release` 的提交触发生产部署。

## 范围

### 范围内

- pnpm workspace、共享 TypeScript/ESLint/Vitest 配置和根级开发命令。
- React + Vite + Tailwind CSS + shadcn components 的 Pages 应用脚手架。
- Cloudflare Worker、按 daemon 分片的 SQLite-backed Durable Object、WebSocket
  Hibernation 接线、D1 binding 和初始 migration。
- 与现有 Silvermoon daemon upstream 设计兼容的共享协议包，包括协议版本、
  daemon identity、请求 ID、接收确认和错误消息的类型边界。
- access token 的入口校验边界、敏感信息保护和可替换的认证验证器接口。
- 单元/集成测试骨架、Wrangler 类型生成、开发文档和 GitHub Actions 发布流水线。
- `silvermoon.work` Pages 域名与 `relay.silvermoon.work` Worker 域名的部署配置。

### 范围外

- 完整用户注册、登录、计费、组织和权限管理产品。
- access token 的签发服务或现有身份系统的迁移；本阶段只定义并验证中继入口所需
  的验证契约。
- 完整任务编辑器、任务调度策略、重试编排和历史分析界面。
- 对 Silvermoon daemon 仓库本身的实现修改，以及所有 upstream protocol
  消息的完整业务处理。
- staging/preview 多环境拓扑、原生移动客户端和非 Cloudflare 云平台部署。

## 约束

- 所有生产外部连接使用 HTTPS/WSS；本地 loopback 开发才允许 HTTP/WS。
- daemon token 仅通过 `Authorization` 或 WebSocket 子协议承载的安全握手机制
  进入服务，不进入 URL query、持久日志、前端 bundle 或错误响应。
- Worker 通过 binding 调用 D1 和 Durable Objects，不从 Worker 内部使用
  Cloudflare REST API。
- Wrangler 使用 `wrangler.jsonc`、当前兼容日期、`nodejs_compat`、observability
  和生成的 binding 类型；DO 通过 migration 声明 SQLite class。
- WebSocket 会话必须允许 hibernation、重连和状态重同步；任何仅存在于内存的
  连接状态都不是权威事实。
- 数据库 schema 变化必须使用可审查的 D1 migration，不在生产启动路径隐式改表。
- GitHub Actions 固定 action 主版本或不可变版本，使用 pnpm lockfile 和
  `--frozen-lockfile`，部署 job 仅在 `release` push 上运行。
- Cloudflare token 与 account ID 通过本机 `cfg` 或 GitHub Actions secrets
  注入；不得提交真实 token、账户私密信息或生成的本地状态。
- 脚手架必须在没有生产凭据时完成本地测试和 dry-run 验证。
