# 本地开发拓扑评审

## 待讨论的决定

- 日常开发以哪种方式建立可用身份：本地专用身份入口，还是三方 OAuth 开发应用。
- 是否采用“loopback 日常环境 + 云端 preview parity gate”的两级运行面。
- 本地 Connector 是由开发命令临时启动，还是允许现有系统 daemon 在 local/production profile 间切换。

## 当前事实

| 观察 | 当前结果 | 影响 |
| --- | --- | --- |
| Web relay origin | 无 `.env.local` 时回退到 `https://relay.silvermoon.work` | localhost Web 直接请求 production |
| CORS | local Worker 与 production Worker 均只允许配置的 `WEB_ORIGIN`；以 `http://localhost:5173` 请求 `/api/me` 均得到 403 且无 CORS header | 浏览器只能呈现 `Failed to fetch`，无法显示服务端错误 |
| Worker 本地配置 | `wrangler.jsonc` 的 `AUTH_BASE_URL` 与 `WEB_ORIGIN` 都是 production 值 | 即使 Web 指向 `localhost:8787`，API 仍拒绝 localhost origin |
| OAuth | `.dev.vars` 缺失时，本地 `/auth/github/start` 返回 500 | 无法在本地建立 browser session |
| 启动与数据 | `pnpm dev` 可启动 Vite 和 Wrangler，但 migration、secret、依赖与 readiness 是分离的手工前置步骤 | 页面可能先于后端或依赖就绪，错误缺少归因 |
| Connector | 当前系统 daemon 指向 production Relay | 本地 Worker 没有真实 Connector 事件，不能验证完整链路 |

## 方案比较

| 方案 | 日常速度 | 线上相似度 | 主要代价 |
| --- | --- | --- | --- |
| A. 双端口 loopback + 本地专用身份入口 | 高 | API、CORS、cookie、CSRF、D1、DO、WebSocket 高；provider OAuth 低 | 必须保证身份入口只存在于本地 profile，防止形成生产旁路 |
| B. 双端口 loopback + 专用 OAuth 开发应用 | 中 | 除真实域名/TLS 外高 | 每位开发者或团队需要 callback、client secret 与 provider 配置 |
| C. 本地 HTTPS 子域名 | 低 | 很高 | hosts、证书信任、端口和跨平台自动化复杂 |
| D. 隔离云端 preview | 低 | 最高 | 需要 Cloudflare/OAuth 资源、远程部署时间和成本控制 |

Vite 反向代理虽能快速消除 CORS，但会隐藏生产中真实存在的跨 origin、cookie domain 与 CSRF 边界，不应成为规范性 parity 环境。

## 建议方向

采用两级运行面：

1. **日常 loopback profile**：固定使用 `http://localhost:5173` 与 `http://localhost:8787`，独立本地 D1/DO、生成的本地安全 secret、显式 origin 配置和临时 Connector。启动编排先检查依赖与配置、应用 migration、等待 `/health`，再报告 Web ready；任何生产 endpoint 或 binding 都视为配置错误。
2. **云端 preview profile**：使用独立子域名、D1、Durable Object namespace、OAuth 应用与 secrets，验证真实 callback、TLS、跨子域 cookie/CORS 和 WebSocket。它是合并前 parity gate，不承担日常热更新。

日常身份建议先在以下两种方式中选择：

- **本地专用身份入口**：通过一次性本地链接创建与 production 相同结构的 user、identity、browser session 与 CSRF cookie；启动条件必须同时限定 Wrangler local runtime、loopback host 和显式 dev flag，production/preview 构建不可启用。
- **专用 OAuth 开发应用**：完整走 provider，但首次配置和 secret 管理更重。适合把 OAuth 本身作为当前调试对象时使用，也可作为 preview 的强制路径。

## 不变量

1. 任一本地命令都不能因配置缺失而回退到 production Relay、D1 或 token。
2. 本地身份便利功能不得在 remote Worker 上激活；preview 必须走真实 OAuth。
3. 本地和 preview Connector 使用独立 ID 与 connection token，不切换或覆盖当前 production daemon。
4. 页面出现网络错误前，启动器应已给出服务 readiness；Worker 中途退出时，诊断应明确区分 unreachable、origin rejected 与 authentication required。

## 未决问题

1. 日常默认身份方式选本地专用入口，还是要求每位开发者配置至少一个 OAuth 开发应用？
2. Preview 是每个分支按需创建，还是维护一个共享、可重置的长期环境？
3. 标准开发命令是否自动启动临时 Connector，还是通过显式 `dev:connector` 保持权限边界？
