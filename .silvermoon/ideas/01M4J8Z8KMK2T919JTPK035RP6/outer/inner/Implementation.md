# Implementation

## Steps

### I-S01: 建立 package 迁移清单

仓库已更名为 `shazhou-ww/silvermoon-ai`，以该 canonical repository 枚举所有工作区 package，记录当前名称、目标 `@silvermoon-ai/*` 名称以及公开或私有属性；迁移不得意外改变发布可见性。

### I-S02: 更新 scope 与仓库引用

统一修改 package manifest、工作区依赖、源码导入、锁文件、脚本、工作流、测试和文档中的 package 名称，只在迁移说明中保留旧 scope。

### I-S03: 完善发布与兼容配置

为可发布 package 配置新的组织归属和发布元数据，并为旧 package 准备弃用或迁移提示；私有 package 继续禁止发布。

## Acceptance criteria

### I-AC01: scope 迁移完整

搜索结果证明旧 scope 仅存在于明确的迁移说明中，逐个 manifest 核对后所有工作区 package 及其内部依赖均使用目标名称。

### I-AC02: 仓库验证通过

使用冻结锁文件完成依赖安装，并通过仓库既有的 lint、类型检查、测试和构建命令，证明重命名没有破坏现有行为。

### I-AC03: 发布边界正确

检查 package 元数据和打包预览，证明可发布产物使用 `@silvermoon-ai/*`，同时所有私有 package 仍被明确标记为不可发布。
