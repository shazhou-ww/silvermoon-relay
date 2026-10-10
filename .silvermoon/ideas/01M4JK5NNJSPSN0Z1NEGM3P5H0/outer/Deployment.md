# Deployment

## Scope

本阶段通过仓库受支持的 `release` 分支流程应用 D1 migration，并部署 Worker 与
Pages。Connector 从同一 primary revision 完成测试、构建与打包核验；根据已验收的
package 发布边界，npm 发布需要另行明确授权，本阶段不修改 package version、不覆盖
现有 `0.1.0`，也不声称 registry 安装的 Device 已自动更新。

## Steps

### D-S01: 发布兼容服务并核验 Connector 产物

将包含修复的最新 primary 合并到 `release`，由既有 workflow 先运行完整质量门，
再应用 `0006_session_hierarchy.sql`、部署 Worker 与 Pages。对同一 revision 的
Connector 运行测试、类型检查、构建和 pack；迁移中的父级列可空、可写能力默认为真，
确保旧 Connector 与既有 Session 不受影响。

### D-S02: 执行真实目录冒烟验证

连接一个同时含父 Session 与 subsession 的真实 Device，刷新目录并验证父子关系、缩进位置与历史打开行为。

## Acceptance criteria

### D-AC01: subsession 在父 Session 下可见

目标环境的 Session API 返回父级标识，Web 列表将代表性 subsession 紧跟父 Session 缩进一级并能打开其历史记录；以脱敏 API 结果和界面截图证明。

### D-AC02: 列表稳定且兼容

release workflow 的质量门、远端 migration、Worker 与 Pages 部署均成功，Connector
产物核验通过；多次目录刷新后无重复或跳位条目，旧 Connector、缺失父级项和既有
顶层 Session 仍可见且可操作。以不可变 workflow、产物核验、冒烟记录和相关错误
监控结果证明。
