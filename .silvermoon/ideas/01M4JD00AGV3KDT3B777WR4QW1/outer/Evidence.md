# Deployment evidence

验证日期：2026-10-10

> 以下发布结果对应上一版已接受的 Implementation。当前 Implementation 增加 tool message 默认隐藏行为后需要重新发布和验证，因此不能作为当前 Deployment gate 的完成证据。

## D-S01 / D-AC01：历史证据

- 已将 accepted primary `a4ed79c4ba14562c2a3b39646bbc2d64c5fff7a8` 通过既有 merge 发布模式晋级为 release commit `4b9b1e697e53765d8b374f88452cf38a6d0c2d6a`；合并后的 Git tree 与该 primary 完全一致。
- GitHub Actions [Check and deploy run 38040905332](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38040905332) 成功完成。
  - `check` job 成功：冻结 lockfile 安装、`pnpm check`、本地 D1 migration。
  - `deploy` job 成功：`pnpm check`、远端 D1 migration、Relay Worker 部署、Pages 部署。
- `https://silvermoon.work/` 返回 HTTP 200；本次发布的 JavaScript 与 CSS 资源均返回 HTTP 200。
- 生产 bundle 包含本次改造的 `Shift+Enter` Composer 提示、`.composer-frame` 和 `.message-time` 样式签名。
- `https://relay.silvermoon.work/api/me` 在未登录请求下返回预期的 HTTP 401 `authentication-required`，同时返回生产 Web origin 的 credentialed CORS 与 `Cache-Control: no-store`。
- 生产登录页桌面视口 `1681 x 724` 下无 document 级溢出，Google、Microsoft、GitHub 三个登录入口均指向生产 Relay。
- 生产登录页窄屏视口 `390 x 844` 下无横向溢出，三个登录入口均可见。

## D-S02 / D-AC02：待完成

受控浏览器没有现存的生产身份会话；GitHub 与 Microsoft 登录入口均正确到达 provider 登录页，但验证过程未代替用户输入账户凭据。因此以下生产端到端证据仍需在真实登录和至少一个在线 Connector 下完成：

- 在桌面视口选择一个 Session 并读取活动历史。
- 发送一条后续消息并确认命令最终成功。
- 在窄屏视口重复 Session 选择、历史读取和继续对话，确认没有阻断布局问题。
