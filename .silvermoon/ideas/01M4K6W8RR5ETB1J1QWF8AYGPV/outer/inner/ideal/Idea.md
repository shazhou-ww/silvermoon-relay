# 允许 waiting Session 继续发送消息

## 问题

Copilot SDK Session 进入 `waiting` 状态后，Relay 会把消息输入区变为只读，用户无法通过后续消息解除等待或继续任务。示例 Session：`903c92c7-0be1-44ca-b3b2-4e1648e68890`。

## 结果

只要 Connector 在线且底层 Session 仍可交互，`waiting` 状态的 Session 就保持消息输入和发送能力；真正只读的 Session 仍明确禁止发送。

## 边界

- `waiting` 继续表示 Session 正在等待输入、确认或外部结果，不改写其状态语义。
- 发送能力以 Agent Host 的实际可交互性为准，不能仅由顶层状态推断。
- 本 idea 不引入新的审批界面或自动批准行为。

## 验收标准

- 在线且可交互的 `waiting` Session 显示可用输入框，用户可发送后续消息。
- 底层明确只读或 Connector 离线时，输入框仍禁用并显示准确原因。
- [UI 对比评审](./ui-review/index.html)清晰呈现 waiting 状态下发送区从禁用到可用的变化；该材料仅用于说明，不是规范性行为契约。
