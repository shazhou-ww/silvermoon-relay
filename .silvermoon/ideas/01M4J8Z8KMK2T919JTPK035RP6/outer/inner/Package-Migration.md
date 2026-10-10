# Package 迁移清单

## Workspace 映射

| 路径 | 旧名称 | 目标名称 | 发布边界 |
| --- | --- | --- | --- |
| `packages/connector` | `@silvermoon-relay/connector` | `@silvermoon-ai/connector` | 可公开发布 |
| `packages/protocol` | `@silvermoon-relay/protocol` | `@silvermoon-ai/protocol` | `private: true` |
| `packages/rpc` | `@silvermoon-relay/rpc` | `@silvermoon-ai/rpc` | `private: true` |
| `apps/worker` | `@silvermoon-relay/worker` | `@silvermoon-ai/worker` | `private: true` |
| `apps/web` | `@silvermoon-relay/web` | `@silvermoon-ai/web` | `private: true` |

仓库根 package 不在 `pnpm-workspace.yaml` 的 package glob 中，并且继续以
`private: true` 作为不可发布的工作区根。

## 发布与兼容边界

- `@silvermoon-ai/connector` 使用 canonical repository
  `https://github.com/shazhou-ww/silvermoon-ai.git`，并明确配置 npm public
  access；其命令名继续为 `silvermoon-connector`。
- 其余四个 package 保留 `private: true`，不得通过 npm 发布。
- Worker、D1 database、健康检查 service 字段和本地 token 文件中的
  `silvermoon-relay` 是既有运行时资源标识，不是 npm package 名称。本次
  实施不改变这些标识，以避免引入部署迁移和兼容性破坏。
- `.silvermoon/ideas` 中已验收或完成的 world contract 与证据保留当时的
  package 名称，作为历史 revision 记录；活动源码、配置和普通文档不得
  继续引用旧 scope，迁移说明除外。
- 新 connector 发布后，在部署阶段为旧 package 设置指向
  `@silvermoon-ai/connector` 的弃用提示；本实施阶段只准备说明，不执行
  registry 变更。
