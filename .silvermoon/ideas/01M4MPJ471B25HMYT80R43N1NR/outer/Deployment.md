# Deployment

## Steps

### D-S01: 验证真实 Done 生命周期

在受支持的 VS Code 与 Agent Host 版本中验证 Done、恢复和真实删除所产生的事件及历史读取能力。

### D-S02: 验证生产链路兼容性

在 Connector、Worker 与 Web 的实际部署组合中验证已有 events、首次补同步和失败重试，不改变既有 Session 身份键。

## Acceptance criteria

### D-AC01: Done 后活动可回看

真实环境证据显示 Session 点击 Done 后不可继续发送，但 Done 前已落库和可补读的 activities 均可查看。

### D-AC02: 失败状态可诊断

断开 connector 或制造 history command 失败时，已存 events 仍显示，界面给出明确失败状态和有效重试路径。
