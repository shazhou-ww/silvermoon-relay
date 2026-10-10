# 将所有 package 迁入 Silvermoon-AI 组织

## 问题

仓库中的工作区 package 仍使用 `@silvermoon-relay/*` 命名，公开发布的 connector 与未来 package 的组织归属也未统一到 Silvermoon-AI。这会让包所有权、发布权限和消费者认知继续分散。

## 结果

所有工作区 package 统一采用 Silvermoon-AI 对应的 `@silvermoon-ai/*` scope；可发布 package 由该组织持有和发布，私有 package 继续保持不可发布。仓库内依赖、自动化和使用说明同步完成迁移。

## 边界

- 覆盖当前所有 `@silvermoon-relay/*` 工作区 package，包括 apps 下的私有 package 和 packages 下的内部或公开 package。
- 不改变 relay 协议、运行时行为或产品部署目标；只处理 package 身份、依赖和发布归属。
- 不回写既有版本；旧 package 仅保留必要的弃用与迁移指引。

## 验收标准

- 仓库内不存在非迁移说明用途的 `@silvermoon-relay/*` 引用，所有工作区 package 均归入 `@silvermoon-ai/*`。
- Silvermoon-AI 组织拥有所有可发布 package，且私有 package 的不可发布边界未被放宽。
- 使用新名称安装、构建、测试和部署均成功，消费者可依据明确指引完成迁移。
