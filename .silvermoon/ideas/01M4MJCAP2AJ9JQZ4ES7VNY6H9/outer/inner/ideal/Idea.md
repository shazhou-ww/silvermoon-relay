# 重构 Session 列表的状态筛选与父子层级

## 问题

当前 Session 列表把不同设备、状态和父子 Session 混在单一时间流中，状态优先级与父子关系都不够清晰。随着更多 Agent 和设备接入，现有筛选与行结构难以保持可扫读性和跨 Agent 一致性。

## 结果

用户可以通过少量预定义状态视图快速定位活动中、等待输入和失败的 Session，并在紧凑树形列表中理解父子关系。列表采用跨 Agent 的统一状态语义，同时保留 Agent 原生状态供详情解释。

## 边界

- 常驻控件仅保留搜索框、`All` 以及按需出现的 `Active`、`Needs input`、`Failed` badge；复杂条件不展开到左侧栏。
- 默认隐藏 `closed` 与 `gone`，视图菜单仅提供 `Show ended`、`Show unavailable` 和 `Group by Device`；暂不增加时间筛选或按 Agent 分组。
- 筛选命中 subsession 时保留并弱化未命中的父级上下文；本 idea 不改变 Session 详情区或消息工作流。

## 验收标准

- 在窄侧栏与移动端列表中，用户能区分父 Session、subsession、当前状态、设备来源和最近活动时间。
- 状态 badge 只在对应 Session 存在时出现并显示数量，搜索与筛选不会让 subsession 无提示地变成顶层项。
- [说明性 UI 评审包](./ui-review/index.html)能公平比较当前列表与拟议方向，并明确未决风险；它不是生产 UI 或规范性行为契约。
