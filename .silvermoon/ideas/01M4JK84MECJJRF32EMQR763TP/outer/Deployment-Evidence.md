# VS Code Agent 消息流部署证据

## 发布状态

- 当前工作分支已与 `origin/main` 同步至
  `84f4359eaa6d01ca38fca07a174b8779c9be68a6`。
- 消息流实现 commit `5151e930ccef37a9e090891f353529c36c3ebc98`
  已包含在 release commit
  `c0471854668e752a503c97a35e8a6188c8e624eb` 中。
- 该 release 由另一个已验收 IDEA 的普通 merge 触发，因此没有重复创建发布提交。
  [workflow run 38049004097](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38049004097)
  的 `check` 与 `deploy` jobs 均为 `success`；同批次成功应用增量
  `0006_session_hierarchy.sql`、部署 Worker 与 Pages。
- 发布后 `https://relay.silvermoon.work/health` 与
  `https://silvermoon.work/` 均返回 HTTP 200。

## 非生产真实 Agent Host 验证

本机真实 VS Code Agent Host 共发现 13 个会话。验证过程没有读取或输出 endpoint
token，没有注入额外 prompt，也没有修改会话正文。

对当前代表性会话的固定观察窗口：

- 初始历史包含 436 个结构化事件和 436 个稳定 part：5 个 request、38 个
  Markdown、393 个工具 part；工具最终状态为 381 个 succeeded 和 12 个 failed。
- 事件 sequence 与各 turn 的 `partIndex` 均单调，未发现丢失、重复或重排。
- 实时订阅收到 6 个工具更新，覆盖 started 与 succeeded。
- 主动断开并重新建立 Agent Host 连接后，历史重放包含 439 个稳定 part；初始
  436 个 identity 全部保留，顺序仍然单调。

随后将同一真实历史送入生产 Web 投影和本地非生产 UI：

- 5 个 turn 全部进入结构化 renderer，没有 legacy event；工具默认隐藏。
- 一个持续更新的窄屏快照包含 421 个工具 part，归并为 36 个连续工具组；
  其中 14 个 failed、406 个 succeeded，另有 1 个活动工具。
- 390 px 视口下 document 与 Session workspace 均无横向溢出；
  显示全部工具后 workspace 的 `clientWidth` 与 `scrollWidth` 仍均为 390 px。
- 原生 `summary` 获得可见焦点后按 Enter 可从关闭切换为打开；界面不显示
  `toolCallId` 等原始 identity。

## 尚未满足的发布证据

- 13 个会话的最终历史中没有处于 waiting 的工具；只读实时窗口也未捕获
  pending-confirmation。不能用单元 fixture 代替合同要求的真实 waiting 状态。
- 当前环境没有生产 Connector token 或已登录 Web session；`/api/me` 返回
  HTTP 403。因此无法抽样核对生产中的旧会话、活动会话与 Connector 版本组合，
  也不能测量真实消息加载和发送错误率。
- 尚未执行生产回退演练。虽然消息流本身没有数据库 migration，同批次的
  `0006_session_hierarchy.sql` 为增量列和索引，仍不能把健康检查表述为回退证明。

因此本次记录不勾选 `D-S01`、`D-S02`、`D-AC01` 或 `D-AC02`。下一步是在安全测试
会话中观察真实 pending-confirmation，再使用已登录生产会话完成兼容性抽样和回退
演练。
