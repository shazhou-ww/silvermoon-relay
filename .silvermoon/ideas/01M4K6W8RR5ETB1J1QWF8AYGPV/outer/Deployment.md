# Deployment

## Steps

### D-S01: 部署 Relay 组件

按现有发布流程部署包含 Connector 和 Web 修复的版本。

### D-S02: 验证真实消息投递

使用 Copilot SDK Connector 打开一个进入 `waiting` 的 Session，发送带唯一标记的后续消息并观察事件流与任务继续执行。

## Acceptance criteria

### D-AC01: 生产路径完成投递

在部署环境中，真实 `waiting` Session 的事件流出现带唯一标记的用户消息，并出现随后产生的 Agent 活动。

### D-AC02: 投递失败可诊断

在部署环境中验证一个不可投递条件，Relay 命令明确失败并返回可定位目标 chat 或连接问题的错误。
