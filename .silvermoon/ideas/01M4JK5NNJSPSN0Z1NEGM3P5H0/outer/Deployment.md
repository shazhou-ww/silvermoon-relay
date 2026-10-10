# Deployment

## Steps

### D-S01: 发布兼容组件

按仓库既有发布流程部署包含修复的 Connector 与 Relay/Web 组件，确保协议兼容的现有 Connector 不受影响。

### D-S02: 执行真实目录冒烟验证

连接一个同时含父 Session 与 subsession 的真实 Device，刷新目录并验证父子关系、缩进位置与历史打开行为。

## Acceptance criteria

### D-AC01: subsession 在父 Session 下可见

目标环境的 Session API 返回父级标识，Web 列表将代表性 subsession 紧跟父 Session 缩进一级并能打开其历史记录；以脱敏 API 结果和界面截图证明。

### D-AC02: 列表稳定且兼容

多次目录刷新后无重复或跳位条目，旧 Connector、缺失父级项和既有顶层 Session 仍可见且可操作；以冒烟记录和相关错误监控结果证明。
