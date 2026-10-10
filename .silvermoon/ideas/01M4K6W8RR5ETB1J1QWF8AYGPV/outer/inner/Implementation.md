# Implementation

## Steps

### I-S01: 复现并定位发送能力误判

用受影响的 Copilot SDK Session 形态和 Agent Host 摘要测试，确认 `waiting` Session 被标记为只读的具体映射路径。

### I-S02: 修正能力映射与发送链路

让可交互的 `waiting` Session 保留 `canSendMessage`，同时维持离线、隐藏和明确只读 Session 的现有保护。

### I-S03: 覆盖 UI 与 Connector 回归

补充针对 waiting、只读和离线状态的自动化测试，验证消息输入状态及 Connector 发送行为。

## Acceptance criteria

### I-AC01: Waiting Session 可发送

自动化测试证明 `waiting` 且可交互的 Session 暴露 `canSendMessage: true`，并能走通消息发送调用。

### I-AC02: 只读保护不回退

自动化测试证明明确只读、隐藏或无可用聊天目标的 Session 仍不能发送消息。

### I-AC03: Web 交互状态准确

Web 测试证明 waiting Session 的输入框可用，而离线或只读 Session 的输入框禁用且提示原因准确。
