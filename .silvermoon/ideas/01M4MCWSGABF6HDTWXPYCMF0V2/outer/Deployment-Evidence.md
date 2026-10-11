# Deployment Evidence

## 生产发布

- release commit: `8f1a47bd5e01426839bdf5caacb6f76f4622216d`
- GitHub Actions run:
  <https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38110554614>
- D1 migration、Relay Worker 与 Pages deployment 均在该 run 中成功。
- Worker version: `0fa34184-bc27-4a59-8deb-48d25307a658`
- Pages deployment:
  <https://7f24a5c9.silvermoon-work.pages.dev>

Windows 首次 profile 创建修复经重新验收后由 release commit
`b0d6b0513c15fd7afde67e0e0fef5947799b8dda` 发布：

- GitHub Actions run:
  <https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38111581695>
- Worker version: `b5cb0157-1c30-4df4-b6cb-267b49e84031`
- Pages deployment:
  <https://86ffeaa2.silvermoon-work.pages.dev>

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

## 生产连接生命周期

从生产 dashboard 添加 `Device token deployment smoke`，使用已验收源码构建的 connector 与原子写入的 Windows profile 验证：

- 首次写入成功，profile ACL 仅允许当前用户；复制为继承宽松 ACL
  后，connector 明确拒绝读取。
- 首次连接由 Relay 推导为 `device-Qb8iBOKxyMFqqZLH`，dashboard
  显示服务端名称、online 状态和 81 个 session。
- 同 token 的第二条连接返回 HTTP 409
  `token-already-connected`；第一条连接保持 online，heartbeat
  从 `2026-10-11 04:30:26` 推进到 `2026-10-11 04:30:47`。
- 正常断开后 dashboard 显示 offline；从同一 profile 无交互重启后，
  设备 ID、名称和 81 个 session 保持不变并恢复 online。
- 不发送 heartbeat 的连接超过 60 秒后，新连接成功接管，过期连接收到
  WebSocket close code `4008`。
- dashboard 撤销 token 返回 HTTP 200；活动连接关闭并无法重新认证，
  dashboard 显示设备 offline 且 token 为 revoked。

测试完成后，本地临时 profile 已删除。最终生产连续性复查仍为 0 个无匹配
device 的 token、session、event 或 command，且
`PRAGMA foreign_key_check` 无结果。
