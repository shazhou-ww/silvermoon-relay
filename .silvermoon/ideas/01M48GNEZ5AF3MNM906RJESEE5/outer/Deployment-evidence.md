# Production deployment evidence

## Release

- 验证时间：`2026-10-06T16:00:50Z` 至 `2026-10-06T16:02:00Z`
- Release commit：`8681e95895623b093d18d1aa8df44faf5ebbcef5`
- GitHub Actions run：<https://github.com/shazhou-ww/silvermoon-relay/actions/runs/37491158569>
- `check` job：成功；冻结 lockfile 安装、完整 `pnpm check` 和本地 D1
  migration 均通过。
- `deploy` job：成功；远端 D1 migration、Worker deploy 和 Pages deploy
  均通过。
- 远端 D1 再检查：`No migrations to apply`。
- Worker version：`759561f7-1bb7-4e17-845a-ba3061e44a05`。
- 上一可识别 Worker version：`5c947215-a291-4b69-af79-2fd7650152c9`。
- Pages deployment：`d10aca06-3566-41b7-8a5f-3da7fdacf674`。
- Pages source：release commit `8681e95`。

## Production configuration

`wrangler secret list` 只返回名称和 `secret_text` 类型。已确认存在：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `CONNECTION_TOKEN_PEPPER`

未配置 `SESSION_SECRET_PREVIOUS` 或
`CONNECTION_TOKEN_PEPPER_PREVIOUS`。secret 值未被读取或写入 evidence。

## Endpoint smoke test

- `https://relay.silvermoon.work/health` 返回 HTTP 200 和
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200，并展示 Google、Microsoft 和 GitHub
  三个登录入口。
- Google start 返回 HTTP 302 到 `accounts.google.com`，包含不可空的 state、
  PKCE challenge、nonce 和精确 callback
  `https://relay.silvermoon.work/auth/google/callback`。
- Microsoft start 返回 HTTP 302 到 `login.microsoftonline.com`，包含不可空的
  state、PKCE challenge、nonce 和精确 callback
  `https://relay.silvermoon.work/auth/microsoft/callback`。
- GitHub start 返回 HTTP 302 到 `github.com`，包含不可空的 state、PKCE
  challenge 和精确 callback
  `https://relay.silvermoon.work/auth/github/callback`；GitHub OAuth 不使用 OIDC
  nonce。

## Remaining production verification

以下项目尚未以真实账号和 daemon 验证，因此不能视为完成：

- Microsoft 和 GitHub 各完成一次 production callback。
- 显式 identity 绑定/解绑、相同 email 隔离、CSRF 和 session 撤销。
- 检查 production observability，确认没有敏感凭据进入日志。

发生普遍登录失败、账户归属错误或撤销失效时，应停止验证并回滚到上一 Worker
version；D1 migration 保持向前兼容，不执行破坏性 schema 回退。

## Authenticated production verification

验证时间：`2026-10-06T16:11:00Z` 至 `2026-10-06T16:15:10Z`。

- Google production callback 成功返回 `https://silvermoon.work/?auth=signed-in`。
- 页面展示已认证账户、Google identity 和当前 browser session；evidence 未记录姓名、
  email、cookie、OAuth code 或 provider token。
- 创建 connection token 后，完整值只在一次性面板显示；关闭面板后列表只显示
  public ID 和尾部提示。
- token 建立真实 daemon WSS 后返回 HTTP 101 和 `relay.ready`，列表随后显示最近
  使用日期。
- 撤销 token 后在线 socket 收到 `connection token revoked`，临时 token 已清理。
- 使用两个不同 token 同时连接同一 daemon ID；撤销 token A 后 A 的 socket 收到
  revoke close，而 token B 的 socket 在观察窗口内继续存活。随后 token B 也被撤销
  并收到 revoke close。
- 所有 production smoke-test token 均已撤销，系统未保留可用测试凭据。
