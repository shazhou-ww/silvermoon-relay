# Subsession 部署证据

## 发布基线

- 部署契约先同步至 primary commit
  `83fcbcdce46e7448baf56b0e333ba46e5ebf2e88`，Silvermoon 观察到
  `deploymentRevision=02b175b93caf` 后才执行发布。
- primary quality gate
  [run 38048922111](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38048922111)
  成功；其 head 为上述 commit。
- 使用普通 merge 将该 primary 合入 `release`，得到 release commit
  `c0471854668e752a503c97a35e8a6188c8e624eb`。未 rebase、force push
  或改写 release 历史。

## Release workflow

[run 38049004097](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38049004097)
在 release commit `c0471854668e` 上完成，`check` 与 `deploy` jobs 均为
`success`：

- 冻结 lockfile 安装、完整 `pnpm check` 与本地 D1 migration 全部成功。
- 远端 D1 明确列出并成功应用 `0006_session_hierarchy.sql`，执行 4 条命令，
  migration 状态为成功。
- Worker `silvermoon-relay` 部署成功，version ID 为
  `20dda09b-8e89-4cb9-a42f-9d74088263e3`。
- Pages 部署成功，不可变 deployment URL 为
  `https://243d8d94.silvermoon-work.pages.dev`。

## Connector 产物

在 primary commit `83fcbcdce46e` 上执行：

- Connector 单元测试：3 个文件、14 项测试全部通过。
- Connector TypeScript 检查通过。
- Connector 构建与声明文件生成通过。
- `pnpm --filter @silvermoon-ai/connector pack` 成功生成
  `silvermoon-ai-connector-0.1.0.tgz`；SHA-256 为
  `8540AF1E1AF7CB9BC639DF6693D9AB4390FA2C4A10A663EA0CBF4408CE5DDC5F`。

该 tarball 仅用于核验。根据 [Deployment.md](./Deployment.md) 的范围，本阶段没有
修改 package version、没有覆盖 npm 上现有 `0.1.0`，也没有执行 npm publish。

## 生产可用性

2026-10-10T11:38:07Z 执行只读检查：

- `https://relay.silvermoon.work/health` 返回 HTTP 200 与
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200。
- 不可变 Pages deployment URL 返回 HTTP 200。

## 真实 Device subsession 冒烟

验证时间：`2026-10-11T02:14:20Z` 至 `2026-10-11T02:29:26Z`。

- 使用发起方提供的 connection token 启动当前 primary checkout 构建的 Connector；
  Relay 接受 Device `show-subsessions-smoke`，token 未写入仓库或证据文件，验证后
  Connector 已停止。
- 在当前 Agent Host Session 下创建一个只读 delegated chat 作为真实 subsession
  夹具。Connector 的 AHP provider 随后返回 5 个 Session，其中 1 个携带父级、
  1 个父 Session 拥有 child、孤儿 child 为 0；父 ID 的脱敏 SHA-256 前 12 位为
  `39065e1ce7c9`。
- 生产 Session API 的脱敏结果见
  [show-subsessions-api.png](./show-subsessions-api.png)：71 个 Session 中找到该
  child，`parentSessionId` 存在且对应父 Session 也存在；父 ID 与 child 的
  `parentSessionId` 哈希均为 `39065e1ce7c9`，`canSendMessage=true`。浏览器只在
  已认证的 `silvermoon.work` 页面内执行只读 fetch，没有导出 cookie。
- 生产目录截图见
  [show-subsessions-parent-child.png](./show-subsessions-parent-child.png)：child
  紧跟父 Session，并相对父项缩进一级。截图只保留这两个相关行，不含账户、
  connection token 或无关会话内容。
- 打开 child 后，生产界面显示该 delegated chat 的只读请求以及预期的
  `Silvermoon Relay` 历史回复，证明 child 历史可独立加载。
- 连续三次刷新生产目录，每次均显示 13 个当前 smoke Device 条目；父项和 child
  各恰好 1 个，父项索引始终为 0、child 索引始终为 1，未出现重复或跳位。
- 冒烟前生产界面已能打开既有 `Copilot SDK test` 顶层 Session；连接新 Device
  后旧 Device 与既有顶层项仍保留。缺失父级、跨 Device、自引用和循环关系继续由
  `apps/web/src/session-list.test.ts` 的回归覆盖。

## 冒烟后复核

- `https://relay.silvermoon.work/health` 返回 HTTP 200 与
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200。
- 再次查询不可变 release
  [run 38049004097](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38049004097)
  时，head 仍为 `c0471854668e`，`check` 与 `deploy` jobs 仍为 `success`；
  migration、Worker 和 Pages 步骤均保持成功。
- Connector 单元测试现为 3 个文件、19 项全部通过；TypeScript 检查、构建与声明
  文件生成通过。
- 当前 checkout 的完整 `pnpm check` 通过；lint 仅保留既有的两个 Fast Refresh
  warning，全部 workspace 类型检查、测试与生产构建成功。
- Web 的 24 项 Playwright 桌面、移动与窄屏回归全部通过；本地隔离 D1 从空库依次
  应用全部六个 migration，`0006_session_hierarchy.sql` 最终状态为成功。

`D-S01`、`D-S02`、`D-AC01` 与 `D-AC02` 的证据均已齐备。
