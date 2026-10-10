# Deployment

## Steps

### D-S01: 配置组织发布权限

在 package registry 的 Silvermoon-AI 组织中确认 package 所有权、维护者权限和自动化发布凭据满足迁移后的发布需求。

### D-S02: 发布并验证新名称

按公开或私有策略发布需要对外分发的 package，并在独立的干净环境中安装新名称、执行 connector 冒烟验证。

### D-S03: 完成旧名称交接

为已发布的旧 package 设置弃用和迁移指引，更新面向消费者的入口，确认生产自动化不再依赖旧 scope。

## Acceptance criteria

### D-AC01: 组织归属可见

registry 中的 package 列表和元数据证明所有可发布 package 均由 Silvermoon-AI 组织持有，并具有预期的可见性。

### D-AC02: 外部安装可用

在不依赖 monorepo 工作区链接的干净环境中安装新 package，并通过 connector 启动或等价冒烟检查证明发布产物可用。

### D-AC03: 旧名称已安全交接

registry 弃用信息、迁移文档和生产工作流共同证明消费者可找到新名称，且线上自动化不再使用旧 scope。
