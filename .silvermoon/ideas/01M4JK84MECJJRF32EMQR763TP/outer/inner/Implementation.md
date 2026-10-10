# Implementation

## Steps

### I-S01: 追踪 VS Code 消息渲染链路

以固定 commit 拉取 VS Code 开源代码，定位 Agent 会话模型、响应片段归约、增量更新和消息组件链路，形成含文件、符号、revision 与许可证边界的[源码映射](./VS-Code-Source-Mapping.md)；同时记录哪些行为仍需实测，不以界面观察代替源码事实。

### I-S02: 定义 Relay 结构化消息流

依据源码映射，在现有 `AgentSessionEvent.data` 中加入 `turnId`、`partId`、`partIndex` 与 `partKind`，以 snapshot 事件表达 Markdown 增量，并以稳定 `toolCallId` 合并工具生命周期。协议保持向后兼容，数据库继续使用 `data_json`，旧事件仍走 legacy renderer；Web 不根据展示文本猜测语义。

### I-S03: 实现分层渲染与验证

在 Web 端用纯投影将事件归并为 turn 和有序 part，按回合渲染 Markdown、连续工具组、结果、错误与系统状态。继续遵守工具消息默认隐藏的既有设置；显式显示后用原生 `details/summary` 渐进披露。用协议、Connector、投影与 Worker 测试覆盖代表性序列，并检查桌面与窄屏。

## Acceptance criteria

### I-AC01: 源码结论可复现

[源码映射](./VS-Code-Source-Mapping.md)包含确切 VS Code commit、路径、符号和 Relay 对应点；用固定 revision 的永久链接和本地 sparse checkout 核对证明结论可复现，并标明未采用或不能直接复用的部分。

### I-AC02: 消息语义与兼容性保持

[实现证据](./Implementation-Evidence.md)中的 fixture 测试证明 Markdown、工具开始与完成、错误、系统通知及活动回合保持身份、顺序和状态，增量事件与历史重放得到一致结果；既有扁平事件有受测的兼容或迁移行为。

### I-AC03: 消息流可读且可访问

[实现证据](./Implementation-Evidence.md)中的组件测试与桌面、窄屏人工检查证明完整回合层级清晰，受支持事件无需查看原始 JSON，折叠或详情控件具有可访问名称、可见焦点和正确键盘顺序。
