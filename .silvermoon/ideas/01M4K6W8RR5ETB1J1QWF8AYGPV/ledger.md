# Ledger

## Implementation

### Implementation steps

- [ ] **I-S01:** 复现并定位静默投递失败
- [ ] **I-S02:** 修正 Agent Host 消息投递
- [ ] **I-S03:** 覆盖成功与失败回归

### Implementation acceptance criteria

- [ ] **I-AC01:** Waiting 消息进入事件流
- [ ] **I-AC02:** 命令成功语义可靠
- [ ] **I-AC03:** 既有发送路径无回退

## Deployment

### Deployment steps

- [ ] **D-S01:** 部署 Relay 组件
- [ ] **D-S02:** 验证真实消息投递

### Deployment acceptance criteria

- [ ] **D-AC01:** 生产路径完成投递
- [ ] **D-AC02:** 投递失败可诊断
