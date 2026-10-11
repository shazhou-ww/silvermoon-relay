# Implementation

## Steps

### I-S01: 分离归档与消失语义

调整 Agent Host provider、adapter 和协议映射，使归档 Session 禁止发送但保留只读历史定位；仅对真实删除或永久不可寻址资源使用 `gone`。

### I-S02: 独立追踪历史新鲜度

让 Relay 以独立 history revision、同步时间或事件序列判断历史是否需要补同步，不再由通用 Session `updated_at` 推导。

### I-S03: 呈现持久化历史与同步结果

Web 先读取并展示 Relay 已存 events，再异步补同步；跟踪命令最终结果，区分归档只读、同步失败和真正空历史。

## Acceptance criteria

### I-AC01: 归档后历史仍可读取

自动化测试证明 Agent-Host-only Session 归档后不可发送但仍能加载并同步历史。

### I-AC02: 状态更新不使历史失效

Worker 测试证明归档或 gone 状态更新时间不会删除 events，也不会单独触发历史过期；离线 GET 仍返回已存 events。

### I-AC03: 详情页反馈可区分

Web 单元或浏览器测试证明已存历史优先展示，异步同步失败有明确提示和重试入口，空历史不会伪装成成功同步。
