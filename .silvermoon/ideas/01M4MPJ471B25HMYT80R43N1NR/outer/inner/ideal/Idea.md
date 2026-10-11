# 保留 Done Session 的历史活动

## 问题

VS Code 将 Session 标记 Done 时只是归档，但 connector 会把它映射为 `gone` 并丢失历史读取 binding。Done 前未同步的 activities 此后无法补读，而已落库历史也会因通用更新时间被误判为过期。

## 结果

归档只结束发送能力，不结束历史可读性。用户打开 Done、gone 或离线 Session 时，应先看到 Relay 已持久化的 activities，并能区分只读归档、补同步失败与真正无历史。

## 边界

- `archived` 与真实删除或永久不可寻址的 `gone` 必须有不同语义；详见 [业务数据模型评审](./Business-Data-Model-Review.md)。
- 已持久化事件不依赖 connector 在线状态展示，Session 状态变化不得隐式删除或隐藏事件。
- 方向包含最小的只读/同步失败反馈；说明性对比见 [UI 评审](./ui-review/index.html)，不在本 idea 重做 Session 列表信息架构。

## 验收标准

- Done 后 Session 不能发送，但 Relay 已存 activities 仍可见。
- Done 前尚未同步的 Agent Host 历史仍有可靠补读路径，或在归档前完成有明确结果的同步。
- 历史补同步失败时界面展示可理解、可重试的状态，而不是与空历史混淆。
