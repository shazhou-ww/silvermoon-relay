# Dummy service deployment evidence

## Release

- Pull request: `https://github.com/shazhou-ww/silvermoon-relay/pull/1`
- Release merge commit: `fe7d01891771e7cfc1ce256f66c2be41119ba4e2`
- GitHub Actions run: `https://github.com/shazhou-ww/silvermoon-relay/actions/runs/37453765539`
- Initial run: `check` 与 `deploy` jobs 均为 `success`。
- Idempotence rerun attempt 2: `check` 与 `deploy` jobs 均为 `success`；远端 D1
  migration 报告无待执行 migration，Worker 与 Pages 再次部署成功。

## Credentials

- GitHub Actions secrets 存在：`CLOUDFLARE_API_TOKEN`、
  `CLOUDFLARE_ACCOUNT_ID`。
- 两次 workflow 完整日志与当前仓库均未发现上述 credential 的实际值。
- Cloudflare token 仅由本机 `cfg` 读取并通过标准输入写入 GitHub secrets。

## Cloudflare resources

- D1 database: `silvermoon-relay`
- D1 database ID: `f1d42229-980e-48f8-b863-f6125dc377e0`
- D1 remote migration status: 无待执行 migration。
- Worker: `silvermoon-relay`
- Latest Worker version: `5c947215-a291-4b69-af79-2fd7650152c9`
- Pages project: `silvermoon-work`
- Latest production Pages deployment:
  `fcd7c695-b209-426c-a236-44a140a1df0c`
- Deployment URL:
  `https://fcd7c695.silvermoon-work.pages.dev`

## Public verification

- `https://relay.silvermoon.work/health` 返回 HTTP 200 和
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon-work.pages.dev` 返回 HTTP 200，页面标题为
  `Silvermoon Relay`。
- Pages custom domain API 报告 `silvermoon.work` 的 domain、verification 与
  validation 状态均为 `active`。
- `silvermoon.work` 的 proxied apex CNAME 指向
  `silvermoon-work.pages.dev`；使用公共 DNS 返回的 Cloudflare anycast 地址验证
  HTTPS 返回 HTTP 200，页面标题为 `Silvermoon Relay`。
