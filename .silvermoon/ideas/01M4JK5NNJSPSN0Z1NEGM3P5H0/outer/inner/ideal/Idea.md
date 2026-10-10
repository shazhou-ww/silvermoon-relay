# 让 subsession 缩进显示在父 Session 下

## 问题

Connector 可访问的 subsession 没有进入 Relay 的 Session 集合，导致仍在进行的子任务不会出现在列表中，用户也无法辨认它与父 Session 的上下文。

## 结果

可用的 subsession 紧跟父 Session 并缩进一级显示，沿用现有列表项的搜索、状态、Device 信息与选择行为。说明性前后对比见 [UI 评审材料](./ui-review/index.html)，父子关系语义见 [业务数据模型评审](./Business-Data-Model-Review.md)。

## 边界

- 只增加一级缩进与轻量连接线，不增加折叠控件或通用树形导航。
- 父子关系只能来自同一 Device 的权威元数据；父级暂不可用时，subsession 仍作为顶层项可见。
- 保持现有 Session 标识、去重、归档过滤与历史记录行为，顶层 Session 不得回归。

## 验收标准

- 当同一 Device 提供顶层 Session 和 subsession 时，Relay Session API 返回两者及可用的父 Session 标识，且标识稳定、无重复。
- Web Session 列表将 subsession 紧跟父 Session 缩进一级；用户可搜索、选择并读取其历史记录。
- 自动化回归覆盖 subsession 的发现与同步，同时证明现有顶层 Session 的列表行为不变。
