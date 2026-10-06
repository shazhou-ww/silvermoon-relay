# Production OIDC/OAuth Provider 配置指导

本文用于创建 production provider application 和配置 Cloudflare Worker。不要在
本文、Git、issue、PR、聊天记录或截图中写入 client secret、OAuth code、cookie、
`SESSION_SECRET`、`CONNECTION_TOKEN_PEPPER` 或 connection token。

## 需要你提供什么

可以在 thread 中提供或确认以下非秘密信息：

- Google OAuth client ID。
- Microsoft application (client) ID。
- GitHub OAuth App client ID。
- 三个 application 的显示名称或后台 URL，以及配置完成时间。
- 已通过 Wrangler 配置下列 secret 名称的确认；只确认名称，不提供值。

不要把三家的 client secret 发给 Agent。推荐由你在本机通过 Wrangler 的交互式
提示直接输入 Cloudflare。若希望 Agent 继续执行部署，只需说明 provider application
已创建、八个 production secrets 已配置，并提供三个非秘密 client ID 供核对。

## 固定 production 地址

| Provider | Application home/origin | 精确 callback |
| --- | --- | --- |
| Google | `https://silvermoon.work` | `https://relay.silvermoon.work/auth/google/callback` |
| Microsoft Account | `https://silvermoon.work` | `https://relay.silvermoon.work/auth/microsoft/callback` |
| GitHub | `https://silvermoon.work` | `https://relay.silvermoon.work/auth/github/callback` |

不要添加 wildcard、HTTP callback、尾部斜杠或其他 host。localhost 开发应创建独立
application 和独立凭据，不复用 production application。

## Google

1. 在 Google Cloud Console 中选择专用 project，配置 OAuth consent screen。
2. 创建类型为 **Web application** 的 OAuth 2.0 client。
3. 将上表 Google callback 作为唯一 production **Authorized redirect URI**。
4. 应用只请求 `openid email profile`。若 consent screen 仍为 Testing，仅允许已登记
   test users；面向真实用户前按 Google 要求发布。
5. 保存 client ID，并立即安全保存新生成的 client secret；不要下载或提交包含
   secret 的 JSON 文件。

官方入口：

- <https://console.cloud.google.com/apis/credentials>
- <https://developers.google.com/identity/protocols/oauth2/web-server>

## Microsoft Account

1. 在 Microsoft Entra admin center 创建 App registration。
2. **Supported account types** 选择仅个人 Microsoft accounts。当前 Worker 使用
   `consumers` endpoint，并验证 Microsoft consumer tenant。
3. 在 **Authentication** 中添加 **Web** platform，并登记上表 Microsoft callback。
   不启用 implicit grant；实现使用 authorization code + PKCE。
4. 在 **Certificates & secrets** 创建 client secret，记录其到期日并设置轮换提醒。
5. 保存 application (client) ID；不要把 directory (tenant) ID 当作 client ID。

官方入口：

- <https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>
- <https://learn.microsoft.com/entra/identity-platform/quickstart-register-app>

## GitHub

1. 在 GitHub **Settings → Developer settings → OAuth Apps** 创建新的 OAuth App。
2. Homepage URL 使用 `https://silvermoon.work`。
3. Authorization callback URL 使用上表 GitHub callback。GitHub OAuth App 的
   production callback 不与 localhost 共用。
4. 生成 client secret 并安全保存。应用登录时请求 `read:user user:email`，只使用
   immutable numeric user ID 和 verified primary email。
5. 保存 Client ID 和 OAuth App 的管理 URL。

官方入口：

- <https://github.com/settings/developers>
- <https://docs.github.com/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>

## 配置 Cloudflare production secrets

从仓库根目录逐项执行以下命令。Wrangler 会交互式请求值；不要把值放在命令参数、
shell history、重定向日志或仓库文件中。

```powershell
pnpm --filter @silvermoon-relay/worker exec wrangler secret put GOOGLE_CLIENT_ID
pnpm --filter @silvermoon-relay/worker exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm --filter @silvermoon-relay/worker exec wrangler secret put MICROSOFT_CLIENT_ID
pnpm --filter @silvermoon-relay/worker exec wrangler secret put MICROSOFT_CLIENT_SECRET
pnpm --filter @silvermoon-relay/worker exec wrangler secret put GITHUB_CLIENT_ID
pnpm --filter @silvermoon-relay/worker exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @silvermoon-relay/worker exec wrangler secret put SESSION_SECRET
pnpm --filter @silvermoon-relay/worker exec wrangler secret put CONNECTION_TOKEN_PEPPER
```

`SESSION_SECRET` 和 `CONNECTION_TOKEN_PEPPER` 必须分别由密码管理器或 CSPRNG
独立生成，至少包含 32 bytes 随机熵，且不能相同。初次部署不要配置
`SESSION_SECRET_PREVIOUS` 或 `CONNECTION_TOKEN_PEPPER_PREVIOUS`；这两个名称仅
用于未来轮换窗口。

完成后只核对名称：

```powershell
pnpm --filter @silvermoon-relay/worker exec wrangler secret list
```

预期存在八个当前 secret 名称。命令输出和后续 evidence 只能保留名称，不得包含值。

## 交付确认格式

完成后可在 thread 中按以下格式回复，方括号内容均不得包含 secret：

```text
Google client ID: [非秘密 client ID]
Microsoft application client ID: [非秘密 client ID]
GitHub OAuth App client ID: [非秘密 client ID]
Provider apps configured at: [RFC 3339 时间]
Cloudflare secrets configured: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, GITHUB_CLIENT_ID,
GITHUB_CLIENT_SECRET, SESSION_SECRET, CONNECTION_TOKEN_PEPPER
```

收到这些非秘密信息和配置确认后，Agent 可以继续 release workflow、production
登录和 connection token smoke test。真实登录验证仍可能需要你在 provider consent
screen 或测试账号中完成交互。
