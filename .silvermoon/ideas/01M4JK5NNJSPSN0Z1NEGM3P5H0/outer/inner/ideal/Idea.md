# 让 subsession 出现在 Session 列表中

## 问题

Connector 可访问的 subsession 没有进入 Relay 的 Session 集合，导致仍在进行的子任务不会出现在列表中，用户也无法从 Web 工作区选择并继续它。

## 结果

可用的顶层 Session 与 subsession 都以现有列表项呈现，沿用相同的排序、搜索、状态、Device 信息与选择行为。说明性前后对比见 [UI 评审材料](./ui-review/index.html)。

## 边界

- 本次只修复会话发现与列表完整性，不引入父子分组、树形导航或新的视觉层级。
- 保持现有 Session 标识、去重、归档过滤与历史记录行为，顶层 Session 不得回归。
- UI 评审材料仅用于说明缺陷与预期结果，不是生产 UI 或规范性行为契约。

## 验收标准

- 当同一 Device 提供顶层 Session 和 subsession 时，Relay Session API 返回两者且标识稳定、无重复。
- Web Session 列表计数与列表项包含 subsession；用户可搜索、选择并读取其历史记录。
- 自动化回归覆盖 subsession 的发现与同步，同时证明现有顶层 Session 的列表行为不变。
