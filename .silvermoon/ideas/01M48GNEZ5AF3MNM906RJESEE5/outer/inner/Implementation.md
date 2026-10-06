# Implementation

## Steps

### I-S01: 建立身份与凭据 schema

新增 D1 migration，把占位 users 表升级为规范化用户模型，并建立
external_identities、browser_sessions、oauth_transactions 和 connection_tokens。
迁移保留已有 daemon/task 关系，增加 token 到 daemon 最近连接的关联和必要唯一
索引，不修改已部署的初始 migration。

### I-S02: 实现 OAuth/OIDC provider 流程

为 Google、Microsoft Account 和 GitHub 建立统一 provider adapter。实现
authorization code + PKCE、state/nonce、短期单次 transaction、callback exchange
和 provider profile 归一化；使用 JOSE/JWKS 验证 Google/MSA ID token，GitHub
使用不可变 numeric ID 与 verified primary email。普通登录不按 email 自动绑定。

### I-S03: 实现 session 与账户 API

实现 opaque browser session、Secure/HttpOnly cookie、CSRF double-submit、严格
Origin/CORS、当前账户、session 列表/撤销、登出和 identity 显式绑定/解绑 API。
OAuth transaction 中必须恢复并验证发起 mode、session 和 return target。

### I-S04: 实现 connection token 生命周期

实现版本化高熵 connection token 的创建、仅一次返回、元数据列表、轮换、撤销、
过期和最近使用更新。D1 只保存 public ID、提示和带 pepper 的摘要；每用户数量、
标签和过期时间有明确限制。

### I-S05: 接入 daemon WSS 鉴权与撤销

把现有单字段 access token 鉴权替换为 connection token 验证，把 user/token/daemon
上下文传入每 daemon Durable Object。DO WebSocket attachment 保存 token ID；
握手时持久化 token 到 daemon 的绑定；token 撤销时查询所有相关 daemon 并通过
RPC 主动关闭使用该 token 的在线连接。

### I-S06: 建立登录与安全管理界面

扩展 Pages React 应用，提供三方登录入口、账户资料、identity 列表、session 列表和
connection token 创建/一次性复制/轮换/撤销体验。所有管理请求携带 credentials
和 CSRF header，不把 token 放入 URL、localStorage 或日志。

### I-S07: 增加安全测试与部署配置

覆盖 PKCE/state、provider claim、session/CSRF、账户绑定、token 一次性显示、
摘要验证、过期/撤销、跨用户隔离和 WSS 关闭路径。配置非秘密 auth vars、秘密清单
和本地示例；保持 GitHub Actions 质量门禁、D1 migration 和 release 部署可重复。

## Acceptance criteria

### I-AC01: 三方登录边界完整

测试证明三个 provider 都生成 PKCE/state，Google/MSA 验证 nonce 与标准 claims，
GitHub 使用 numeric ID；callback state 重放、provider 混淆和无效 claim 均失败，
且 email 相同不会自动合并身份。

### I-AC02: 浏览器 session 安全

响应 cookie 具有 Secure、HttpOnly、SameSite 与过期属性；测试证明未知 Origin、
缺失/错误 CSRF、过期或撤销 session 不能执行修改，用户只能列出和撤销自己的
session。

### I-AC03: connection token 安全可治理

创建/轮换响应只显示一次完整 token，后续列表不含 secret；D1 仅保存摘要和提示。
测试证明有效 token 可认证，错误、过期、撤销和其他用户 token 被拒绝，数量和输入
限制生效。

### I-AC04: 撤销影响在线 daemon

测试证明 token ID 写入 DO WebSocket attachment；撤销后对应 DO 中使用该 token 的
socket 被关闭，而同一 daemon 上其他 token 的连接不受影响，新握手立即返回 401。

### I-AC05: 身份绑定避免账户接管

identity 由 provider+subject 唯一确定；绑定需当前 session 和新鲜 provider 回调，
已属于其他用户的 identity 不能绑定，最后一个 identity 不能解绑。测试覆盖所有
冲突与隔离路径。

### I-AC06: 前端管理体验可验证

生产构建展示 Google/MSA/GitHub 登录、账户、identity、session 和 token 管理；
一次性 token 有明确复制与不可恢复提示，窄屏无横向溢出，静态产物不含 provider
client secret、session secret 或 connection token。

### I-AC07: 完整质量门禁通过

冻结 lockfile 安装、lint、Wrangler types、TypeScript、全部测试、Pages build、
Worker deploy dry-run、全新本地 D1 migration 和 Silvermoon worktree/staged
检查均通过，且凭据扫描无真实 secret。
