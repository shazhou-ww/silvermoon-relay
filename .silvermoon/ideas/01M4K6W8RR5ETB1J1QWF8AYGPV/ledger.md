# Ledger

## Implementation

### Implementation steps

- [ ] **I-S01:** 复现并定位发送能力误判
- [ ] **I-S02:** 修正能力映射与发送链路
- [ ] **I-S03:** 覆盖 UI 与 Connector 回归

### Implementation acceptance criteria

- [ ] **I-AC01:** Waiting Session 可发送
- [ ] **I-AC02:** 只读保护不回退
- [ ] **I-AC03:** Web 交互状态准确

## Deployment

### Deployment steps

- [ ] **D-S01:** 部署 Relay 组件
- [ ] **D-S02:** 验证真实 waiting Session

### Deployment acceptance criteria

- [ ] **D-AC01:** 生产路径可继续会话
- [ ] **D-AC02:** 不可发送状态保持受控
