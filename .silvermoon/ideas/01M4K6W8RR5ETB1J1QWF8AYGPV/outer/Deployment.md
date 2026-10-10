# Deployment

## Steps

### D-S01: 部署 Relay 组件

按现有发布流程部署包含 Connector 和 Web 修复的版本。

### D-S02: 验证真实 waiting Session

使用 Copilot SDK Connector 打开一个进入 `waiting` 的 Session，发送后续消息并观察任务继续执行。

## Acceptance criteria

### D-AC01: 生产路径可继续会话

在部署环境中，真实 `waiting` Session 可提交一条后续消息，并由 Session 事件流证明消息被接收且执行继续。

### D-AC02: 不可发送状态保持受控

在部署环境中抽查离线或明确只读 Session，界面仍禁止发送并显示对应提示。
