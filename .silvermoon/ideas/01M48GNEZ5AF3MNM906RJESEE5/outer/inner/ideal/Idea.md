# OAuth 身份与 daemon connection token 管理

## 意图

让用户通过 Google、Microsoft Account（MSA）或 GitHub 安全登录
`silvermoon.work`，并在自己的账户中创建、查看元数据、轮换和撤销供 Silvermoon
daemon 连接 relay 使用的 connection token。

## 背景

现有 Cloudflare relay 脚手架已经部署 Pages、Worker、每 daemon 一个 Durable
Object 和 D1，并要求 daemon 使用 bearer token 连接
`wss://relay.silvermoon.work/v1/daemon/connect`。当前 D1 只有一个直接位于
`users` 表的 `access_token_hash` 占位字段，没有用户登录、身份提供商绑定、浏览器
session 或独立 token 生命周期，因此真实用户尚不能自行获得和治理连接凭据。

登录身份和 daemon connection token 是两个不同的安全边界：OAuth/OIDC provider
证明用户身份，浏览器 session 授权用户操作管理 API；connection token 只授权
daemon 连接 relay，不能充当浏览器 session、OAuth access token 或第三方 API
凭据。

## 期望结果

- 未登录用户可从 `silvermoon.work` 选择 Google、Microsoft Account 或 GitHub
  登录。所有 provider 使用 authorization code flow、PKCE、不可预测且一次性的
  state；支持 OIDC 的 provider 同时验证 nonce、签名、issuer、audience 和时效。
- 登录成功后，relay 依据 `(provider, provider subject)` 的不可变组合识别身份并
  建立 Silvermoon 用户。email、名称和头像仅作为资料，不以 email 自动合并不同
  provider，避免同名邮箱导致账户接管。
- 已登录用户可显式绑定另一个 provider。绑定必须从当前有效 session 发起并完成
  目标 provider 的新鲜认证；不能把一次普通登录或相同 email 静默解释为账户绑定。
  用户不能解绑最后一个可登录身份。
- 浏览器获得短期、可撤销的 opaque session cookie；cookie 为 `HttpOnly`、
  `Secure`、限定 relay host，并采用合适的 `SameSite`、过期与轮换策略。修改型 API
  同时验证允许的 Origin 和 CSRF 证明。
- 用户可创建带标签和可选过期时间的 connection token。完整 token 使用高熵随机
  secret，只在创建或轮换成功的响应中显示一次；此后列表只返回 token ID、前缀/
  尾部提示、标签、创建时间、过期时间、最近使用时间和撤销时间。
- connection token 使用稳定公开 ID 定位记录，只持久化 secret 的安全摘要，不在
  D1、日志、错误、analytics、URL、Pages bundle 或 Durable Object storage 中保存
  明文。比较使用固定时间语义，token 值不能通过列表或恢复接口取回。
- 用户可立即撤销 token，也可原子轮换为一个新 token；撤销、过期或属于其他用户的
  token 无法建立新的 daemon WebSocket。已有连接的策略明确：撤销后由 relay 主动
  关闭使用该 token 的在线连接，或在有界时间内强制重新认证，不能无限保持授权。
- 一个用户可以拥有多个 token，以支持多设备和独立轮换；默认 scope 仅为
  `daemon:connect`。本 idea 不引入可以调用任意管理 API 的长期 bearer token。
- token 成功认证后，relay 将 token 所属 user、token ID 和 daemon ID 绑定到对应
  Durable Object，并异步更新 D1 的最近使用元数据；WebSocket 路由仍按
  `userId:daemonId` 确定性分片。
- 前端提供登录页、当前账户/已绑定身份、connection token 列表、创建一次性展示、
  复制确认、轮换和撤销流程。敏感 token 显示后离开页面即不可恢复，并给出明确的
  daemon 配置指引。
- 用户可安全登出当前 session，并能查看和撤销自己的其他活跃浏览器 sessions。
  OAuth provider access/refresh token 在取得身份资料后立即丢弃；除非未来有明确
  第三方 API 需求，不持久化 provider token。
- OAuth client secret、session/CSRF 密钥和 token 摘要 pepper 等秘密仅存在于
  Cloudflare secrets 与 GitHub Actions secrets，通过本机 `cfg` 安全配置。

## 范围

### 范围内

- Google OpenID Connect 登录。
- Microsoft identity platform v2 的个人 Microsoft Account 登录。
- GitHub OAuth 登录，以及取得经验证 primary email 所需的最小 scope。
- 首次登录用户创建、三方身份显式绑定/解绑和账户资料展示。
- D1 中规范化的 users、external identities、browser sessions、OAuth transaction
  和 connection tokens schema/migrations。
- Worker 端 OAuth initiation/callback、session、CSRF、账户、身份绑定和 token
  管理 API。
- 现有 daemon WSS 认证改为 connection token 模型，并接入撤销/过期语义。
- Pages React 登录、账户、安全和 token 管理界面。
- provider callback URL、Cloudflare secrets、GitHub Actions 部署与端到端安全
  测试。

### 范围外

- 用户名/密码、magic link、短信登录、企业 SAML/SCIM 和 Cloudflare Access 登录。
- 组织、团队、邀请、多用户共享 daemon、角色权限和管理员后台。
- OAuth provider token 驱动的 Google、Microsoft 或 GitHub API 产品功能。
- 多因素认证、passkey 和账户恢复流程；这些可在后续 idea 中建立。
- connection token 以外的通用公开 API key、细粒度任务权限和计费配额。
- 完整任务发布与 daemon 执行协议；本 idea 只为其建立可靠用户与连接凭据边界。
- 自动合并历史占位用户数据；若生产 D1 已有真实记录，迁移必须另行审计。

## 约束

- 所有 OAuth redirect URI 必须是预注册的精确 HTTPS 地址；本地开发使用单独的
  client 配置，生产 callback 固定在 `relay.silvermoon.work`。
- OAuth transaction 短期有效、单次消费，并绑定 provider、PKCE verifier、state、
  nonce、预期 redirect 和发起 session；callback 重放或 provider 混淆必须失败。
- 对 Google/MSA 必须验证 OIDC ID token；GitHub 身份使用不可变 numeric user ID，
  不使用可变 username 或未验证 email 作为 subject。
- session 与 token ID 使用 Web Crypto 生成，不使用 `Math.random()`。敏感值不得
  通过 query parameter、日志或分析事件传播。
- 浏览器 API 仅允许 `https://silvermoon.work` 的 credentialed CORS；生产环境拒绝
  未知 Origin。OAuth top-level navigation callback 与普通 CORS API 分开处理。
- D1 是用户、identity、session 和 token 元数据的权威；Durable Object 只缓存当前
  连接所需的最小授权上下文，并在撤销通知后关闭对应连接。
- 安全相关写入使用 D1 transaction/批处理保持唯一 identity、token 轮换和撤销的
  一致性；所有查询参数化，并为 provider subject、session hash、token ID/hash 和
  用户列表建立必要索引。
- connection token 格式必须可版本化并包含非秘密公开 ID，以便 O(1) 定位记录；
  secret 至少 256 bit 熵。数据库泄露不应直接产生可用 token。
- 用户拥有 token 数量、OAuth transaction 频率、callback 失败和 token 创建/
  撤销接口必须有明确上限或限流，错误响应不得成为身份、email 或 token 枚举信道。
- provider client secret、session signing/encryption key 和 token pepper 均不得
  进入仓库；秘密轮换需支持短暂多 key 验证窗口，不要求全体用户同时登出。
- schema 变化通过新的 D1 migration 交付，不修改已经部署的 `0001_initial.sql`。
- release workflow 继续作为唯一生产部署入口；provider 应用注册、callback 配置和
  真实登录验证需形成可审查的 Deployment evidence。
