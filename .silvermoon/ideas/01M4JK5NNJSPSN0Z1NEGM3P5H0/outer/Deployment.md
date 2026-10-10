# Deployment

## Steps

### D-S01: 应用迁移并发布兼容组件

先应用 `0006_session_hierarchy.sql`，再按仓库既有发布流程部署包含修复的 Worker、Web 与 Connector。迁移中的父级列可空、可写能力默认为真，确保旧 Connector 与既有 Session 不受影响。

### D-S02: 执行真实目录冒烟验证

连接一个同时含父 Session 与 subsession 的真实 Device，刷新目录并验证父子关系、缩进位置与历史打开行为。

## Acceptance criteria

### D-AC01: subsession 在父 Session 下可见

目标环境的 Session API 返回父级标识，Web 列表将代表性 subsession 紧跟父 Session 缩进一级并能打开其历史记录；以脱敏 API 结果和界面截图证明。

### D-AC02: 列表稳定且兼容

迁移与组件发布均无错误；多次目录刷新后无重复或跳位条目，旧 Connector、缺失父级项和既有顶层 Session 仍可见且可操作；以迁移记录、冒烟记录和相关错误监控结果证明。
