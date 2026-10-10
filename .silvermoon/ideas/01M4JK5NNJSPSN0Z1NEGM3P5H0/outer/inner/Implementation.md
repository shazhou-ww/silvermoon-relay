# Implementation

## Steps

### I-S01: 补齐 subsession 发现

在实际提供会话目录的 Connector 数据源中识别可用 subsession，并将其规范化为现有 `AgentSession`，同时保留稳定 ID、状态、时间与预览信息。

### I-S02: 保持同步链路完整

确认 Connector 上传、Relay 持久化及 Session API 不会丢弃或重复 subsession，并保持现有归档过滤、排序和顶层 Session 行为。

### I-S03: 建立回归覆盖

为发现、同步与 Web 列表消费添加针对性测试，并用包含一个顶层 Session 和一个 subsession 的代表性数据验证完整流程。

## Acceptance criteria

### I-AC01: Connector 返回完整会话集合

给定数据源中的顶层 Session 与 subsession，Connector 列表结果同时包含两者的稳定 ID；由 Connector 单元测试证明。

### I-AC02: Relay 同步无丢失或重复

连续目录刷新后，Session API 对每个顶层 Session 和 subsession 各返回一次，并保留其最新状态与活动时间；由 Worker/协议测试证明。

### I-AC03: Web 列表可操作 subsession

列表计数、搜索、选择和历史加载均可作用于 subsession，且既有顶层 Session 场景保持通过；由 Web 测试及代表性手工验证证明。
