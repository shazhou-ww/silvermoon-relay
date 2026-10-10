# Implementation

## Steps

### I-S01: 补齐 subsession 与父级发现

在实际提供会话目录的 Connector 数据源中识别可用 subsession 及其权威父级，将其规范化为 `AgentSession`，同时保留稳定 ID、状态、时间与预览信息。

### I-S02: 贯通可选父级关系

在 Connector 协议、Relay 持久化与 Session API 中增加可选 `parentSessionId`，校验父子 Session 属于同一 Device，并为旧 Connector 与缺失父级提供兼容回退。

### I-S03: 构建缩进列表与回归

让 Web 将 subsession 紧跟父 Session 缩进一级显示，并为发现、同步、排序、搜索、选择及缺失父级回退添加针对性测试。

## Acceptance criteria

### I-AC01: Connector 返回父子会话集合

给定数据源中的顶层 Session 与 subsession，Connector 列表结果同时包含两者的稳定 ID，并为 subsession 提供父 Session ID；由 Connector 单元测试证明。

### I-AC02: Relay 保留安全父级关系

连续目录刷新后，Session API 对每个会话各返回一次并保留同 Device 父级关系；旧 Connector 和暂缺父级的记录仍可读取；由协议、迁移和 Worker 测试证明。

### I-AC03: Web 缩进项保持可操作

subsession 紧跟父 Session 缩进一级，列表计数、搜索、选择和历史加载均可作用于它；父级缺失时该项保持顶层可见；由 Web 测试及代表性手工验证证明。
