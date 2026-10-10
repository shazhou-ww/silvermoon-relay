# Deployment

## Steps

### D-S01: 发布兼容组件

按仓库既有发布流程部署包含修复的 Connector 与 Relay/Web 组件，确保协议兼容的现有 Connector 不受影响。

### D-S02: 执行真实目录冒烟验证

连接一个同时含顶层 Session 与 subsession 的真实 Device，刷新目录并验证两类会话在 Relay 中持续可见和可打开。

## Acceptance criteria

### D-AC01: subsession 在目标环境可见

目标环境的 Session API 与 Web 列表均显示代表性 subsession，并能打开其历史记录；以脱敏 API 结果和界面截图证明。

### D-AC02: 列表稳定且兼容

多次目录刷新后无重复或闪退条目，既有顶层 Session 仍可见且可操作；以冒烟记录和相关错误监控结果证明。
