# Deployment

## Steps

### D-S01: 配置隔离 preview 运行面

按最终选择创建独立 preview 域名、Worker、D1、Durable Object、OAuth 开发应用和 secrets，确保所有资源与 production 分离。

### D-S02: 执行生产等价链路验证

在 preview 域名完成真实 provider 登录、跨 origin API、session/CSRF 与 Connector WebSocket 流程，记录可重复的 parity 证据和资源隔离证据。

## Acceptance criteria

### D-AC01: Preview 通过真实认证与 Relay 流程

浏览器和 Worker 日志共同证明 preview OAuth callback、session cookie、CORS/CSRF、Connector 连接及一次 session 操作成功。

### D-AC02: Preview 与 production 资源隔离

Cloudflare binding、OAuth callback 和 token 审计证明 preview 只使用专用域名、D1、Durable Object namespace、应用凭据与 connection token。
