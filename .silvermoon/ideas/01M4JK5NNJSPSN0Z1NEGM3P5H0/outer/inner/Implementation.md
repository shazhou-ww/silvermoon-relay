# Implementation

## Steps

### I-S01: 补齐 subsession 与父级发现

使用 AHP 1.0 根目录中的 `SessionSummary.chats` 作为权威 subsession 目录：父 Session 代表默认 Chat，其余非隐藏、非归档 Chat 使用稳定哈希 ID 投影为子 `AgentSession`。子项绑定原始 Chat resource，因此历史加载和可写子项的后续消息会路由到正确 Chat；read-only Chat 保持可见但不可发送消息。

### I-S02: 贯通可选父级关系

在 Connector 协议、Relay 持久化与 Session API 中增加可选 `parentSessionId` 和派生的 `canSendMessage` 能力。D1 迁移使用可空父级列且不增加阻止孤儿写入的自外键；API 总是返回父级与可写状态，并在服务端拒绝 read-only Session 的消息命令。旧 Connector 缺省为顶层且可写。

### I-S03: 构建缩进列表与回归

Web 先应用搜索与 attention 过滤，再按 `(connectorId, sessionId)` 解析父子关系。有效子项紧跟父项并仅缩进一级，不绘制连接线；父级缺失、跨 Device、自引用或循环关系均安全退化为顶层项。read-only 项仍可选择并读取历史，但编辑器禁用发送。

## Acceptance criteria

### I-AC01: Connector 返回父子会话集合

给定包含默认、read-only、隐藏与归档 Chat 的 AHP Session，Connector 仅返回一个父项和可见非默认子项，子项 ID 跨刷新稳定且携带父 ID；`packages/connector/src/vscode-agent-host-provider.test.ts` 覆盖目录映射，完整 Connector 测试 14 项通过。

### I-AC02: Relay 保留安全父级关系

协议接受不含新字段的旧 Session，也接受可选父级和 read-only 能力；Worker 集成测试证明子项可先于父项同步、API 保留父级、read-only 历史仍可读取且消息被拒绝。全部六个 D1 迁移已在隔离本地数据库成功应用，Protocol 5 项与 Worker 17 项测试通过。

### I-AC03: Web 缩进项保持可操作

`apps/web/src/session-list.test.ts` 的 3 项测试证明父子邻接、同父排序、过滤后孤儿、跨 Device、自引用和循环回退；生产样式只增加桌面与移动端一级缩进，没有连接线。全仓库 42 项测试、lint 与生产构建通过，相关包 TypeScript 检查通过。
