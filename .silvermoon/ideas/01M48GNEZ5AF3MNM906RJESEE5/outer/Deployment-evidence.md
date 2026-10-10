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

所有部署合同项目均已验证。发生普遍登录失败、账户归属错误或撤销失效时，应停止
发布并回滚到上一 Worker version；D1 migration 保持向前兼容，不执行破坏性
schema 回退。

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

## Identity and session boundary verification

验证时间：`2026-10-06T16:18:00Z` 至 `2026-10-06T16:26:00Z`。

- Microsoft 和 GitHub 均完成 production callback，并通过 link mode 加入现有
  Google 账户；三家 identity 同时显示为 linked，原 browser session 保持有效。
- 缺失 CSRF header 的修改请求返回 403，未知 Origin 的 API 请求返回 403。
- 登出后原 browser session 访问 `/api/me` 返回 401。
- 移除两个辅助 identity 后，尝试移除最后一个 Google identity 返回 409。
- 在移除 GitHub identity 后以 GitHub 执行普通登录。即使 provider email 与原
  Google identity 相同，返回的 Silvermoon user ID 仍不同，且新账户只包含 GitHub
  identity，证明没有按 email 自动合并。
- 上述临时 GitHub-only user 没有 token 或 daemon；验证后退出 session，并以受限
  条件删除其 user、identity 和 session 三条记录。
- 重新登录原 Google user 后，Microsoft 和 GitHub 均重新通过新鲜 link callback
  绑定；最终 user ID 与验证前一致，三家 identity 均恢复。
- evidence 未记录姓名、email、provider subject、user ID、cookie 或 OAuth code。

## Observability verification

使用 `wrangler tail --format json` 观察一次专门触发的 `/health` 请求：

- Worker version 为 `759561f7-1bb7-4e17-845a-ba3061e44a05`，outcome 为 `ok`，
  response status 为 200。
- `logs`、`exceptions` 和 diagnostics 均为空。
- 事件不含 OAuth code、provider token、session cookie、connection token 或
  Authorization header。
- 验证后立即停止 tail；evidence 不持久化请求 IP 或 TLS 指纹。
