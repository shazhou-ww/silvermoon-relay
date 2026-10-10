# Deployment evidence

验证日期：2026-10-10

## D-S01 / D-AC01：已完成

- 已将包含 accepted Implementation `20ac981e6776312ac048a1ebad2b40a2fc8464c2` 的 primary `5d2acda61415db7aaf4528b429e9a4485be0909c` 通过既有 merge 发布模式晋级为 release commit `2367a456b336f4a8fcbf3df22c4250c4f310631f`；合并后的 Git tree 与该 primary 完全一致。
- GitHub Actions [Check and deploy run 38043369999](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38043369999) 成功完成。
  - `check` job 成功：冻结 lockfile 安装、`pnpm check`、本地 D1 migration。
  - `deploy` job 成功：`pnpm check`、远端 D1 migration、Relay Worker 部署、Pages 部署。
- `https://silvermoon.work/` 与本次 JavaScript 资源 `/assets/index-CuDlXnBf.js` 均返回 HTTP 200。
- 生产 bundle 包含当前改造的 `Tool messages are hidden`、tool message 显隐开关及 `Shift+Enter` Composer 提示。
- `https://relay.silvermoon.work/api/me` 在未登录请求下返回预期的 HTTP 401 `authentication-required`，同时返回生产 Web origin 的 credentialed CORS 与 `Cache-Control: no-store`。
- 生产登录页桌面视口 `1681 x 724` 下无 document 级溢出，Google、Microsoft、GitHub 三个登录入口均指向生产 Relay。
- 生产登录页窄屏视口 `390 x 844` 下无横向溢出，三个登录入口均可见。

## D-S02 / D-AC02：待完成

受控浏览器没有现存的生产身份会话；GitHub 与 Microsoft 登录入口均正确到达 provider 登录页，但验证过程未代替用户输入账户凭据。因此以下生产端到端证据仍需在真实登录和至少一个在线 Connector 下完成：

- 在桌面视口选择一个 Session 并读取活动历史。
- 发送一条后续消息并确认命令最终成功。
- 在窄屏视口重复 Session 选择、历史读取和继续对话，确认没有阻断布局问题。
