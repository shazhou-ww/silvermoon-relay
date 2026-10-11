# Deployment Evidence

## 生产发布

- release commit: `8f1a47bd5e01426839bdf5caacb6f76f4622216d`
- GitHub Actions run:
  <https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38110554614>
- D1 migration、Relay Worker 与 Pages deployment 均在该 run 中成功。
- Worker version: `0fa34184-bc27-4a59-8deb-48d25307a658`
- Pages deployment:
  <https://7f24a5c9.silvermoon-work.pages.dev>

## 数据连续性

发布前生产查询没有发现同一 token 绑定多个 connector 的歧义数据。发布后：

- `connection_tokens` 缺失匹配 device：0
- `agent_sessions` 缺失匹配 device：0
- `agent_session_events` 缺失匹配 device：0
- `connector_commands` 缺失匹配 device：0
- `PRAGMA foreign_key_check`：无结果
- `wrangler d1 migrations list --remote`：无待应用 migration

## 公开端点

- `https://relay.silvermoon.work/health` 返回
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200。
- 客户端选择身份的旧连接路径返回 HTTP 409
  `connector-identity-managed-by-relay`。

## Connector 发布边界

npm `0.2.0` 发布不属于本次 deployment。生产生命周期验证使用当前已验收源码构建的 connector；待发布变更记录在
`packages/connector/CHANGELOG.md`。
