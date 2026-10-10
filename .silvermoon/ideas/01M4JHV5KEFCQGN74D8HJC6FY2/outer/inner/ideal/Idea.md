# 建立接近线上的本地开发运行面

## 问题

当前 `pnpm dev` 虽会启动 Web 与 Worker，但 Web 默认请求生产 Relay，Worker 仍使用生产 origin 配置，本地 OAuth secrets、D1 数据和 Connector 也没有统一引导。结果是浏览器反复显示 `Failed to fetch` 或登录失败，开发者无法判断故障来自服务未就绪、CORS、认证还是数据缺失。

## 结果

开发者可通过一个明确入口启动隔离的本地 Web、Worker、D1 和 Connector 流程，使用与线上相同的 API、CORS、cookie、CSRF 与 session 路径；另有隔离 preview 环境验证真实 OAuth callback 和域名差异。拓扑选项与建议见 [本地开发拓扑评审](Local-Development-Topology.md)。

## 边界

- 本地与 preview 均不得读取或写入生产 D1、生产 session、生产 connection token 或生产 OAuth secret。
- 日常本地模式优先稳定、可重置和一条命令启动；只有浏览器域名、TLS 与真实 provider callback 等无法在 loopback 忠实复现的部分进入 preview parity gate。
- 本 idea 改造开发运行面和诊断，不改变面向最终用户的产品信息架构或业务数据模型。

## 验收标准

- 从已声明的本地前置条件执行标准开发命令后，服务在 readiness 通过时给出可访问 URL，Web 不再因 origin 或启动竞态持续出现 `Failed to fetch`。
- 开发者能在隔离数据中完成登录、浏览器 session、CSRF 写操作和本地 Connector 连接，并能显式重置环境。
- preview 环境能证明 OAuth callback、跨 origin cookie/CORS 和 Connector WebSocket 在生产等价域名下工作，且隔离检查证明未接触生产资源。

## 下一步

确认日常模式采用“本地专用身份入口”还是“专用 OAuth 开发应用”作为默认登录方式。
