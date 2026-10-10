# Implementation

## Steps

### I-S01: 复现并定位静默投递失败

沿 Relay 命令、Connector、Agent Host chat 与 AHP 1.0.0 dispatch 追踪后确认：`InputNeeded` 仍有 active turn，普通 queued message 只会在该 turn 结束后消费；同时 dispatch 是无回执通知，原实现会提前报告成功。

### I-S02: 修正 Agent Host 消息投递

当 active turn 有且只有一个开放的文本 input request 时，Connector 以 `chat/inputCompleted` 提交答案；其他 active turn 继续采用 queued message。所有消息 action 都等待同一 client sequence 的服务端 echo，rejection、连接关闭和超时明确失败。

### I-S03: 覆盖成功与失败回归

补充文本 input 完成、结构化 input 拒绝、答案事件回填以及 dispatch 接受、拒绝和超时测试，并运行 Connector 测试、类型检查、lint 与构建。

## Acceptance criteria

### I-AC01: Waiting 消息进入事件流

自动化测试证明 waiting 文本 input 被转换为接受的 `chat/inputCompleted`，其持久历史投影包含对应用户消息。

### I-AC02: 命令成功语义可靠

自动化测试证明 Connector 只在匹配的 action echo 到达后完成命令，并对服务端 rejection 与确认超时返回错误。

### I-AC03: 既有发送路径无回退

Connector 的完整测试、类型检查、lint 与构建通过；既有 active turn 排队、只读保护和 Session 状态映射测试保持通过。
