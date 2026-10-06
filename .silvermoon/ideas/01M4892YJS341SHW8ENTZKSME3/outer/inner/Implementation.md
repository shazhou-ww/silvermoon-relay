# Implementation

## Steps

### I-S01: 建立 monorepo 基础

创建 pnpm workspace、根级 TypeScript/ESLint/Vitest 配置、统一脚本、忽略规则和
开发文档。根 `package.json` 声明与运行版本匹配的 Silvermoon devDependency，
并从项目依赖重新注册 canonical skill。

### I-S02: 定义共享中继协议

建立无运行时平台依赖的共享 TypeScript 包，定义版本化 daemon 身份、连接就绪、
任务请求、持久接收确认、拒绝和投递观察消息。使用运行时 schema 校验不可信
WebSocket 消息，并用测试固定协议边界。

### I-S03: 实现 Worker 与 Durable Object 骨架

配置 Worker、D1、SQLite-backed Durable Object migration、observability 和
`relay.silvermoon.work` custom domain。实现健康检查、access token 握手边界、
每 daemon 确定性 DO 路由、WebSocket Hibernation、连接附件恢复、DO SQLite
状态和最小任务投递接口；敏感凭据不进入 URL、日志或持久层。

### I-S04: 建立 D1 schema 与访问层

添加初始 D1 migration，建立 users、daemons、tasks 与 task status events 的关系
schema；实现参数化查询的最小仓储边界，使 D1 承担跨 daemon 查询投影而不取代
DO 对连接协调和幂等接收的权威。

### I-S05: 建立 Pages React 应用

使用 Vite、React、Tailwind CSS 和 shadcn components 建立响应式应用外壳，提供
服务状态、daemon 列表和任务发布入口占位。前端从显式环境变量读取 relay origin，
不包含生产 access token 或伪造任务成功状态。

### I-S06: 增加自动验证与 release 部署

添加 Worker/DO、共享协议和前端的针对性测试；配置 GitHub Actions 在 pull request
和 push 上运行冻结依赖安装与质量门禁，并仅在 `release` push 时依次应用远端 D1
migration、部署 Worker 和 Pages。凭据只引用 GitHub Actions secrets。

### I-S07: 完成本地验证和文档

生成 Wrangler binding 类型，执行 lint、typecheck、test、build、D1 migration
本地应用与 Worker dry-run，修复所有由本次脚手架引入的问题，并记录可复现的本地
开发和发布准备命令。

## Acceptance criteria

### I-AC01: Workspace 可重复安装与构建

全新 checkout 使用仓库声明的 pnpm 版本执行 `pnpm install --frozen-lockfile` 后，
根级 `pnpm check` 全部通过；以 lockfile、命令退出码和构建产物证明。

### I-AC02: 中继连接边界可验证

测试证明缺失或无效 bearer token、非 WebSocket upgrade 和无效 daemon identity
均被明确拒绝；有效请求确定性路由到对应 daemon DO，且响应和日志不回显 token。

### I-AC03: DO 长连接可休眠恢复

测试或 Miniflare 集成验证 DO 使用 `acceptWebSocket`、序列化附件和
`webSocketMessage`/`webSocketClose` handler，关键连接/投递状态写入 SQLite
storage；实例重建不依赖模块或对象内存作为权威状态。

### I-AC04: D1 与 DO 数据职责清晰

本地 D1 migration 可成功应用，schema 包含跨 daemon 的注册与任务投影；DO schema
仅包含单 daemon 的连接协调与幂等接收数据。配置和测试证明两者 binding 均可用。

### I-AC05: Pages 界面可用且无秘密

前端生产构建成功，界面在桌面与窄屏呈现可访问的状态卡、daemon 空状态和任务入口，
并实际使用仓库中的 shadcn Button/Card/Input/Badge 组件；静态产物扫描不包含
Cloudflare token 或测试 access token。

### I-AC06: release 流水线符合发布边界

workflow 静态检查证明部署 job 仅响应 `release` push，在部署前运行质量门禁和 D1
migration，分别发布 Worker 与 Pages，并只从 `CLOUDFLARE_API_TOKEN`、
`CLOUDFLARE_ACCOUNT_ID` secrets 获取凭据。

### I-AC07: Cloudflare 配置可 dry-run

Wrangler 类型检查、Worker deploy dry-run、Pages production build 和本地 D1
migration 命令均以零退出码完成；`wrangler.jsonc` 声明当前 compatibility date、
`nodejs_compat`、observability、D1 binding、DO binding、SQLite migration 与
`relay.silvermoon.work` custom domain。
