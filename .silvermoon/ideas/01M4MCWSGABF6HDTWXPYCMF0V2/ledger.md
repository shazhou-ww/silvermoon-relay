# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 建立稳定设备与凭据关系
- [x] **I-S02:** 由 Relay 执行单连接租约
- [x] **I-S03:** 收敛添加设备与本地配置体验
- [x] **I-S04:** 收敛 API、UI 与兼容边界

### Implementation acceptance criteria

- [x] **I-AC01:** 身份与单连接约束可证明
- [x] **I-AC02:** 历史归属保持连续
- [x] **I-AC03:** 一次配置即可安全重启
- [x] **I-AC04:** 覆盖优先级与兼容迁移清晰

## Deployment

### Deployment steps

- [x] **D-S01:** 分阶段迁移设备身份
- [x] **D-S02:** 验证生产连接生命周期

### Deployment acceptance criteria

- [x] **D-AC01:** 既有设备无身份断裂
- [x] **D-AC02:** 单连接策略在 Relay 生效
- [x] **D-AC03:** 新设备可从安全 profile 重启
