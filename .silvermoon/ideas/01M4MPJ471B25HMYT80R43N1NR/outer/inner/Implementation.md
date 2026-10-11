# Implementation

## Steps

### I-S01: 分离归档与消失语义

Agent Host provider 将 `IsArchived` 映射为只读 `closed`，继续保留 parent、subsession 及其 binding；连接仍有效时，后续 `sessionRemoved` 不再把已知归档误报为 `gone`。真实消失仍沿原路径发布 `gone`。

### I-S02: 独立追踪历史新鲜度

Relay 新增 `history_synced_at`，仅在 `session.history` command 成功完成时与 command 状态同一 D1 batch 更新。Session 状态与 `updated_at` 后续变化不再使历史失效。

### I-S03: 呈现持久化历史与同步结果

Web 继续独立轮询已存 events，并把 history command 纳入既有 command 轮询。归档详情显示只读说明；同步失败显示原因与重试入口，不覆盖已加载 transcript。

## Acceptance criteria

### I-AC01: 归档后历史仍可读取

自动化测试证明 Agent-Host-only Session 归档后不可发送但仍能加载并同步历史。

### I-AC02: 状态更新不使历史失效

Worker 测试证明归档或 gone 状态更新时间不会删除 events，也不会单独触发历史过期；离线 GET 仍返回已存 events。

### I-AC03: 详情页反馈可区分

Web 单元或浏览器测试证明已存历史优先展示，异步同步失败有明确提示和重试入口，空历史不会伪装成成功同步。

实施与验证记录见 [Implementation-Evidence.md](./Implementation-Evidence.md)。
