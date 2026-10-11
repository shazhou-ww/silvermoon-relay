# Implementation

## Steps

### I-S01: 建立稳定设备与凭据关系

调整领域与持久化模型，使服务端设备身份拥有可撤销凭据，并迁移现有 connector、token 与会话归属；对一个 token 曾关联多个 connector 的歧义数据显式阻断而非猜测归属。

### I-S02: 由 Relay 执行单连接租约

认证后由 Relay 推导设备 ID 与名称，以 token 为粒度原子获取活跃连接租约；拒绝重叠连接，连接关闭或租约失效后释放，并保持命令与事件的设备隔离。

### I-S03: 收敛添加设备与本地配置体验

将 token 创建与 connector 配置统一为“添加设备”流程，并将 Relay 地址、token 与非敏感选项写入 `$HOME/.silvermoon/connector.yaml`。创建和更新必须原子进行，并在 POSIX 使用 `0600`、在 Windows 限制 ACL 为当前用户；环境变量与显式 token 文件保留为覆盖方式。移除新配置中的自定义 connector ID 和显示名，并为既有安装提供明确迁移路径。

## Acceptance criteria

### I-AC01: 身份与单连接约束可证明

自动化测试证明 token 只能连接其服务端设备，重叠连接被拒绝且既有连接继续工作，断线或租约失效后可重连。

### I-AC02: 历史归属保持连续

迁移与重连测试证明既有 agent session、事件和命令仍归属于同一稳定设备；歧义映射产生可操作错误而非静默拆分或合并。

### I-AC03: 一次配置即可安全重启

UI、API 与 CLI 测试证明用户只在添加设备时命名一次；首次配置安全写入用户级 profile 后，connector 可无交互重启；权限不安全时明确拒绝读取，日志不泄露 token，且客户端参数不能覆盖设备身份。
