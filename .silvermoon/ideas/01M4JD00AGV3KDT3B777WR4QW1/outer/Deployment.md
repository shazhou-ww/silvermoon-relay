# Deployment

## Steps

### D-S01: 通过现有发布路径交付 Web UI

使用既有 `release` 工作流部署 Pages 产物，不新增生产服务、凭据或数据迁移。

### D-S02: 验证生产端到端旅程

在生产域名使用真实登录和 Connector 验证桌面与窄屏的 Session 浏览、历史读取和继续对话。

## Acceptance criteria

### D-AC01: 发布质量门禁通过

现有 CI、Pages 构建和发布步骤成功完成，生产静态资源加载无新增错误；以 workflow 与部署结果证明。

### D-AC02: 生产 Session 工作流可用

真实账户可在至少一个已连接 Device 上选择 Session、读取活动并发送后续消息，且桌面与窄屏布局无阻断问题；以生产 smoke evidence 证明。

## Evidence

当前发布与生产 smoke 结果见 [Evidence.md](./Evidence.md)。
