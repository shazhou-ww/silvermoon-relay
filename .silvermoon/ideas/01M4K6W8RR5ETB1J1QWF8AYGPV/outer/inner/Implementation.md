# Implementation

## Steps

### I-S01: 复现并定位静默投递失败

用受影响的 Copilot SDK waiting Session 形态追踪 Relay 命令、Connector、Agent Host chat 选择和 dispatch，定位命令成功但 Session 无响应的断点。

### I-S02: 修正 Agent Host 消息投递

确保 Connector 向 waiting Session 的正确可写 chat 提交用户消息，并只在底层接受投递后报告命令成功。

### I-S03: 覆盖成功与失败回归

补充 waiting Session 正常继续、chat 不可写、连接失效和投递拒绝的 Connector 自动化测试。

## Acceptance criteria

### I-AC01: Waiting 消息进入事件流

自动化测试证明向 waiting Session 发送的消息到达正确 chat，并投影为新的用户消息和后续活动。

### I-AC02: 命令成功语义可靠

自动化测试证明 Connector 不会在 dispatch 未接受、目标 chat 不可写或连接失效时报告命令成功。

### I-AC03: 既有发送路径无回退

现有运行中 Session 的后续消息测试继续通过，并证明 waiting 修复不改变只读保护与 Session 状态映射。
