# VS Code Agent 消息流实现证据

## 交付映射

| 合同项 | 可复现证据 | 结果 |
| --- | --- | --- |
| I-S01 / I-AC01 | [源码映射](./VS-Code-Source-Mapping.md)固定 `microsoft/vscode@959031245ebb1fe077e0d512e1397c0ae82006e4`，记录源码符号、永久链接、MIT 许可证及不采用范围 | VS Code 的有序 response part、稳定工具 identity 和按 kind 渲染策略均可由固定 revision 复核 |
| I-S02 | [协议 schema](../../../../../packages/protocol/src/index.ts)定义兼容的 event metadata；[Connector 映射](../../../../../packages/connector/src/vscode-agent-host-provider.ts)逐 part 输出历史与活动回合；[Worker 往返测试](../../../../../apps/worker/src/index.test.ts)验证 metadata 经 RPC、D1 与 events API 后不变 | 未增加数据库列或协议版本；旧事件仍可读取 |
| I-S03 | [Web 投影](../../../../../apps/web/src/message-flow.ts)按稳定 identity 合并 snapshot 与工具状态；[专用 renderer](../../../../../apps/web/src/App.tsx)和[样式](../../../../../apps/web/src/index.css)呈现 Markdown、工具组、系统、活动与错误 | 工具默认隐藏；显式显示后按生命周期合并并渐进披露 |
| I-AC02 | [协议测试](../../../../../packages/protocol/src/index.test.ts)、[Connector 测试](../../../../../packages/connector/src/vscode-agent-host-provider.test.ts)、[投影测试](../../../../../apps/web/src/message-flow.test.ts)及 Worker 往返测试 | 覆盖 Markdown → tool → Markdown → system 的源顺序、稳定 `toolCallId`、snapshot 收敛、连续工具分组与 legacy 过滤 |
| I-AC03 | 下述真实 Web 构建检查 | 受支持事件无需原始 JSON；工具 disclosure 可键盘操作并保留可见焦点 |

## 自动验证

在仓库根目录运行 `pnpm check`：

- lint 通过；保留两个既有 Fast Refresh warning。
- 全 workspace typecheck 通过，包括 `wrangler types --check`。
- 36 个测试通过：Protocol 4、Web 3、Connector 12、Worker 17。
- Protocol、RPC、Web、Connector 与 Worker dry-run build 全部通过；Web 仅报告既有的大 chunk 提示。

## 产品渲染检查

以本地 Vite 运行真实 Web 应用，通过浏览器请求拦截注入包含 Markdown 表格、代码块、两个工具生命周期、失败状态及系统通知的结构化 Session：

- 1440 × 1000：工具初始隐藏；切换后两个稳定工具 part 合并为一个连续工具组，成功与失败状态清晰，原始 `toolCallId` 不可见。
- 390 × 844：Session workspace 的 `clientWidth` 与 `scrollWidth` 均为 390 px，没有文档级横向溢出；代码块保留局部横向滚动。
- 原生 `summary` 获得焦点后按 Enter 可切换 `details`，焦点仍停留在 `SUMMARY` 且匹配 `:focus-visible`。
- Markdown、工具组、后续 Markdown 与系统通知保持源 part 顺序；隐藏工具不会改变其余 part 的相对顺序。
