# Ledger

## Implementation

### Implementation steps

- [x] **I-S01:** 建立 monorepo 基础
- [x] **I-S02:** 定义共享中继协议
- [x] **I-S03:** 实现 Worker 与 Durable Object 骨架
- [x] **I-S04:** 建立 D1 schema 与访问层
- [x] **I-S05:** 建立 Pages React 应用
- [x] **I-S06:** 增加自动验证与 release 部署
- [x] **I-S07:** 完成本地验证和文档

### Implementation acceptance criteria

- [x] **I-AC01:** Workspace 可重复安装与构建
- [x] **I-AC02:** 中继连接边界可验证
- [x] **I-AC03:** DO 长连接可休眠恢复
- [x] **I-AC04:** D1 与 DO 数据职责清晰
- [x] **I-AC05:** Pages 界面可用且无秘密
- [x] **I-AC06:** release 流水线符合发布边界
- [x] **I-AC07:** Cloudflare 配置可 dry-run

## Deployment

### Deployment steps

- [ ] **D-S01:** 配置最小权限部署凭据
- [ ] **D-S02:** 创建 Cloudflare dummy 资源
- [ ] **D-S03:** 通过 release merge 触发首次部署
- [ ] **D-S04:** 绑定域名并验证 dummy service
- [ ] **D-S05:** 固化部署证据与恢复路径

### Deployment acceptance criteria

- [ ] **D-AC01:** GitHub secrets 已安全配置
- [ ] **D-AC02:** release merge workflow 成功
- [ ] **D-AC03:** Worker 与数据资源在线
- [ ] **D-AC04:** Pages 与主域名在线
- [ ] **D-AC05:** dummy 部署可重复且无秘密
