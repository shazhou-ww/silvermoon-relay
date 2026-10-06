# Deployment

## Steps

### D-S01: 创建并约束三方 provider application

按照 `OIDC-Provider-Setup.md` 分别创建 Google、Microsoft Account 和 GitHub
production application。每个 application 只登记对应的精确 HTTPS callback，
选择与实现一致的账户类型和最小 scopes，并记录不含 secret 的 application
标识、配置截图或导出信息。

### D-S02: 配置 production Worker secrets

通过 Wrangler 的交互式 secret 输入配置三组 client ID/client secret，以及独立的
`SESSION_SECRET` 和 `CONNECTION_TOKEN_PEPPER`。初次部署不配置 `_PREVIOUS`
变量；仅在未来轮换窗口中短期使用。使用 secret 名称列表和部署时间作为证据，不
读取、打印或持久化 secret 值。

### D-S03: 通过 release workflow 部署

将已验收实现合入 `release`，由唯一 release workflow 依次应用远端 D1
migrations、部署 Worker/Durable Object，并部署 Pages 产物。保存 workflow run、
部署版本和 migration 成功记录。

### D-S04: 验证 production 身份与 session 边界

在 `silvermoon.work` 分别完成 Google、Microsoft Account 和 GitHub 登录，验证
账户资料、显式 identity 绑定/解绑、登出、session 列表和撤销。使用独立测试身份
确认相同 email 不会静默合并账户，并记录去标识化结果。

### D-S05: 验证 production connection token 生命周期

创建仅显示一次的 connection token，以真实 daemon 建立 WSS；验证列表不返回
secret、最近使用时间更新、轮换后旧 token 失效，以及撤销会关闭对应在线 socket
且不影响同一 daemon 使用其他 token 的连接。测试后撤销所有临时 token。

### D-S06: 固化证据与回滚条件

在 Outer World 中记录不含凭据和个人资料的 provider、Cloudflare、workflow 与
production smoke-test 证据。确认 Worker 版本可回滚、D1 migration 为向前兼容，
并列明发生登录普遍失败、账户边界错误或撤销失效时停止发布和回滚 Worker 的条件。

## Acceptance criteria

### D-AC01: 三方 production callback 可用

Google、Microsoft Account 和 GitHub 均从 `https://silvermoon.work` 发起并返回各自
预登记的 `https://relay.silvermoon.work/auth/<provider>/callback`；production
浏览器证据证明三方各完成一次登录，错误 provider、redirect 或账户类型不会被接受。

### D-AC02: Production secrets 安全配置

`wrangler secret list` 或等价 Cloudflare 配置证据只显示所需 secret 名称，代码库
和构建产物的凭据扫描无真实值；`SESSION_SECRET` 与
`CONNECTION_TOKEN_PEPPER` 独立生成，初次部署不存在 `_PREVIOUS` 值。

### D-AC03: 身份和 session 行为符合合同

Production 验证证明 provider subject 决定身份，相同 email 不自动合并，显式绑定
需要当前 session，最后一个 identity 不能解绑；未知 Origin、错误 CSRF、已撤销或
过期 session 不能执行管理操作。证据不得包含 OAuth code、cookie 或个人资料。

### D-AC04: Connection token 和在线撤销可用

Production daemon 证据证明完整 token 仅出现一次，有效 token 可连接，轮换或撤销
后旧 token 的新握手返回 401；已在线的目标 socket 被关闭，同一 daemon 的其他
token 连接保持可用，所有临时 token 在验证后均被撤销。

### D-AC05: Release 可追溯且服务健康

Release workflow 的 migration、Worker 和 Pages jobs 全部成功；`/health`、登录页和
账户管理页可访问，部署版本与 primary commit 可对应。证据包含 workflow run URL、
Cloudflare deployment 标识和无敏感信息的 smoke-test 时间。

### D-AC06: 回滚与观测准备完成

Cloudflare 保留可识别的上一 Worker version，运维人员可执行 Worker rollback；
观测中没有 OAuth code、provider token、session cookie 或 connection token。
已记录触发回滚的条件和 D1 migration 不执行破坏性回退的处理方式。
