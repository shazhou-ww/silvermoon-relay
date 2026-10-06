# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 建立身份与凭据 schema
- [x] **I-S02:** 实现 OAuth/OIDC provider 流程
- [x] **I-S03:** 实现 session 与账户 API
- [x] **I-S04:** 实现 connection token 生命周期
- [x] **I-S05:** 接入 daemon WSS 鉴权与撤销
- [x] **I-S06:** 建立登录与安全管理界面
- [x] **I-S07:** 增加安全测试与部署配置

### Implementation acceptance criteria

- [x] **I-AC01:** 三方登录边界完整
- [x] **I-AC02:** 浏览器 session 安全
- [x] **I-AC03:** connection token 安全可治理
- [x] **I-AC04:** 撤销影响在线 daemon
- [x] **I-AC05:** 身份绑定避免账户接管
- [x] **I-AC06:** 前端管理体验可验证
- [x] **I-AC07:** 完整质量门禁通过

## Deployment

### Deployment steps

- [x] **D-S01:** 创建并约束三方 provider application
- [x] **D-S02:** 配置 production Worker secrets
- [x] **D-S03:** 通过 release workflow 部署
- [ ] **D-S04:** 验证 production 身份与 session 边界
- [x] **D-S05:** 验证 production connection token 生命周期
- [x] **D-S06:** 固化证据与回滚条件

### Deployment acceptance criteria

- [ ] **D-AC01:** 三方 production callback 可用
- [x] **D-AC02:** Production secrets 安全配置
- [ ] **D-AC03:** 身份和 session 行为符合合同
- [x] **D-AC04:** Connection token 和在线撤销可用
- [x] **D-AC05:** Release 可追溯且服务健康
- [ ] **D-AC06:** 回滚与观测准备完成
