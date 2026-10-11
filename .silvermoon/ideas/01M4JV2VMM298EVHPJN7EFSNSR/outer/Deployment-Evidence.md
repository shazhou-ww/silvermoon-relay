# 消息流滚动部署证据

验证日期：2026-10-10。以下为外部部署和生产观察记录，不代表 Deployment 验收。

## D-S01：发布完成

- 已验收的 `implementationRevision=b5f39687a0ec1c6bfdea2a79fbbd44c8b5d7f9eb` 位于 primary `650820e543660282945aa33611e4da3de06d3c2b`。
- 使用现有 release 普通合并流程晋级为 release commit `1853a6dc3387a9cafd58fc28fff1781c8485664c`；验证该提交包含上述 primary，且两者 Git tree 完全一致。没有重写 release 历史，也没有修改实现或部署配置。
- [Check and deploy run 38063076619](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38063076619) 的 check 与 deploy jobs 均成功。
  - check：冻结 lockfile 安装、完整 `pnpm check`、真实 Chromium 浏览器回归 24 项、本地 D1 migration 均成功。
  - deploy：完整 `pnpm check`、远端 D1 migration 检查、Worker 与 Pages 发布均成功；远端报告没有需要应用的 migration。
  - Worker version：`aff9f917-2c32-4c73-ab3f-01f3da1aa2b6`。
  - Pages deployment：[dbeff6be](https://dbeff6be.silvermoon-work.pages.dev)。
  - 发布任务完成时间：2026-10-10T15:21:39Z（北京时间 23:21:39）。

## 发布后生产可用性检查

2026-10-10T15:22:46.681Z（北京时间 23:22:46）完成以下生产检查：

- `https://relay.silvermoon.work/health` 返回 HTTP 200，正文为 `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200，引用的 JavaScript `/assets/index-BWvhg8t_.js` 与 CSS `/assets/index-yu8RfmFz.css` 均返回 HTTP 200，文件名与 release CI 构建输出一致。
- 实际生产 JavaScript 包含 `Jump to latest`、可访问消息区名称 `Session messages` 与减少动态效果处理；CSS 包含消息区外壳和返回控件样式。这证明已发布目标资源，但不能代替登录后的交互证据。
- 真实 Chromium 分别打开生产站点的 1440×900 桌面和 320×640 窄屏视口：登录页面无横向溢出，无 pageerror，三个身份提供方入口均可见并指向生产 Relay。
- 生产浏览器调用 `/api/me` 均返回 HTTP 401 `authentication-required`。不带 Origin 的命令行请求返回 HTTP 403 `origin-not-allowed`，与浏览器的未认证结果分别记录，不尝试绕过认证或 Origin 限制。

2026-10-11T02:14:04.256Z（北京时间 10:14:04）重新执行外部检查：

- `https://relay.silvermoon.work/health` 与 `https://silvermoon.work/` 均返回 HTTP 200；生产首页仍引用 `/assets/index-BWvhg8t_.js` 和 `/assets/index-yu8RfmFz.css`，两项资源均返回 HTTP 200。
- 生产 JavaScript 仍包含 `Jump to latest`、`Session messages` 和 `prefers-reduced-motion`，CSS 仍包含 `transcript-shell` 与 `transcript-jump`。
- 不可变 Pages deployment `https://dbeff6be.silvermoon-work.pages.dev/` 返回 HTTP 200。
- `origin/release` 仍指向部署提交 `1853a6dc3387a9cafd58fc28fff1781c8485664c`；该提交、当前 `origin/main` 与生产部署之间的 `apps/web` 内容没有差异。

## D-S02 / D-AC01 / D-AC02：真实登录后的生产 smoke

2026-10-11T02:15:25.830Z（北京时间 10:15:25），用户在默认浏览器自行完成生产 OAuth 登录；验证过程没有向 Agent 提供凭据、认证状态或 Session 正文。用户选择一条具有足够历史记录的生产 Session，并报告桌面和约 320px 窄屏的以下检查全部通过：

1. 打开长 Session 时直接位于最新可见消息；停留在底部时，新增事件保持可见。
2. 向上阅读历史后显示 `Jump to latest`；新增事件到达时没有把阅读位置拉回底部。
3. 鼠标点击及 Tab/Enter 激活控件后均回到底部，控件隐藏，消息区和输入区没有遮挡。
4. 桌面和约 320px 窄屏均通过初始定位、历史阅读保护和返回最新消息操作。

上述生产观察完成 D-S02，并为 D-AC01 与 D-AC02 提供带时间的外部证据；实现阶段的本地/CI 浏览器回归仅作为发布前补充，不替代本次生产人工观察。
