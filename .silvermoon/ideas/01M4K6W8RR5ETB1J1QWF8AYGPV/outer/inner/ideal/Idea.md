# 修复 waiting Session 后续消息投递

## 问题

Copilot SDK Session 进入 `waiting` 状态后，Relay 的消息输入和发送按钮仍可用，但提交后 Session 没有响应，也没有继续执行。示例 Session：`903c92c7-0be1-44ca-b3b2-4e1648e68890`。

## 结果

Connector 将后续消息可靠投递到 waiting Session 的正确 Agent Host chat；成功发送后，用户能从 Session 事件流观察到新消息被接收并继续执行，投递失败则返回明确错误。

## 边界

- Web 发送控件和 `waiting` 状态展示维持现状，本 idea 不做 UI 改版。
- 修复覆盖 Copilot SDK Connector 经 Agent Host 向既有 Session 发送后续消息的链路。
- 不引入自动批准行为，也不把“命令已入队”误报为“消息已被 Session 接收”。

## 验收标准

- 向可交互的 `waiting` Session 发送后续消息后，事件流出现对应用户消息，Session 随后产生新的活动。
- Connector 选择并投递到该 Session 的可写 chat，不因 waiting 状态或 chat 目录刷新而静默丢失消息。
- 无可写 chat、投递被拒绝或连接失效时，Relay 命令以失败结束并保留可诊断错误。
