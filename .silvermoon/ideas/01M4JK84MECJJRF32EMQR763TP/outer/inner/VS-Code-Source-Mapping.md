# VS Code Agent 消息流源码映射

## 固定来源

- Repository: `microsoft/vscode`
- Commit: [`959031245ebb1fe077e0d512e1397c0ae82006e4`](https://github.com/microsoft/vscode/commit/959031245ebb1fe077e0d512e1397c0ae82006e4)
- 获取方式: `git clone --filter=blob:none --depth 1 --branch main --no-checkout https://github.com/microsoft/vscode.git`，随后以 sparse checkout 读取 `src/vs/platform/agentHost/common/state` 和 `src/vs/workbench/contrib/chat/{common,browser}`。
- License: [MIT License](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/LICENSE.txt)。本实现只采用可观察的模型与渲染策略，不复制 VS Code 源码、样式或资源。

## 可复现链路

### 1. Agent Host 以有序 response part 表达一个回合

[`ResponsePartKind` 与 `ResponsePart`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/platform/agentHost/common/state/protocol/channels-chat/state.ts#L1007)把 Markdown、工具、reasoning、系统通知、输入请求和错误保存在同一个有序数组中。Markdown 与 reasoning 有稳定 part ID，工具以 `toolCallId` 作为 part identity。

[`chatReducer`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/platform/agentHost/common/state/protocol/channels-chat/reducer.ts#L335)通过 `chat/responsePart` 追加新 part，并通过 `chat/delta` 按 `partId` 更新已有 Markdown，而不是把所有 Assistant 文本合并到回合末尾；工具开始与完成同样更新已有工具 part。

### 2. 历史与活动回合共享相同 part 顺序

[`turnsToHistory`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L1165)按 `turn.responseParts` 原顺序将已完成回合映射成 chat progress。

[`activeTurnToProgress`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L1622)对活动回合执行同一类映射，并把工具的 running、confirmation、authentication、completed 与 cancelled 状态保留在稳定 invocation 上。因此实时更新与历史重放可以进入同一 renderer。

### 3. 模型维护 part，renderer 按 kind 分派

[`Response.updateContent`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/common/model/chatModel.ts#L1003)只合并可合并的相邻 Markdown，并保留非 Markdown part 的边界。工具 invocation 本身保存并更新生命周期状态。

[`ChatResponseViewModel.response`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/common/model/chatViewModel.ts#L624)直接暴露上述 response；[`ChatListItemRenderer.renderChatContentPart`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts#L4472)再按 `kind` 选择 Markdown、工具、错误、系统通知等专用 content part。工具 renderer 会观察同一 invocation 的状态变化，见 [`ChatToolInvocationPart`](https://github.com/microsoft/vscode/blob/959031245ebb1fe077e0d512e1397c0ae82006e4/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatToolInvocationPart.ts#L85)。

## Relay 对应设计

| VS Code 策略 | Relay 当前缺口 | Relay 适配 |
| --- | --- | --- |
| 一个 turn 拥有有序 response parts | Connector 把 Assistant Markdown 合并后放到所有工具事件之后 | 每个事件在 `data_json` 中携带 `turnId`、`partId`、`partIndex` 与 `partKind`；历史映射逐 part 输出 |
| delta 更新稳定 part | Web 只按 event ID 逐条展示 | 增量事件携带同一 `partId` 的完整 snapshot；Web 纯投影选取最新 snapshot |
| 工具生命周期保留稳定 `toolCallId` | start 与 complete 是互不关联的卡片 | Web 以 `turnId + toolCallId` 合并为一个工具 part，并用最新状态渲染 |
| 按 kind 使用专用 renderer | 非消息事件显示原始文本或 JSON | Markdown、工具组、系统通知、活动与错误各用语义化 renderer |
| 进度细节渐进披露 | 工具仅能全部隐藏或显示原始卡片 | 继续遵守现有“默认隐藏工具消息”设置；显式显示后以工具组和原生 `details/summary` 呈现，不依赖原始 JSON |

## 明确不采用

- 不复制 VS Code 的 DOM、CSS、图标、专用工具 UI 或内部 service 架构。
- 不在本期显示 provider reasoning 正文；该内容需要独立的产品与隐私决策。
- 不为结构化消息新增数据库列。现有事件类型与旧数据继续可读，新 identity 仅作为兼容的 `data_json` 扩展。
- 不把 session activity 强行解释为 Markdown 或工具；没有结构化 metadata 的旧事件继续走 legacy renderer。
