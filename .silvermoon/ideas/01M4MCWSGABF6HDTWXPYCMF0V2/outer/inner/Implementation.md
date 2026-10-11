# Implementation

## Steps

### I-S01: 建立稳定设备与凭据关系

新增服务端 `devices` 身份与 token 固定绑定，使 connector 连接仅代表设备的运行通道。迁移保留既有 connector ID 作为设备 ID，并原样迁移 agent session、事件和命令的归属；对一个 token 曾关联多个 connector 的数据用可验证的迁移失败显式阻断，不静默猜测。

### I-S02: 由 Relay 执行单连接租约

认证后由 Relay 从 token 推导设备 ID 与名称，并以 token 为 Durable Object 唯一键原子获取带到期时间的活跃连接租约。重叠连接稳定返回冲突且不关闭既有连接；正常关闭、撤销或租约失效后释放，并保持命令与事件的设备隔离。

### I-S03: 收敛添加设备与本地配置体验

将 token 创建与 connector 配置统一为“添加设备”流程，并将 Relay 地址、token 与非敏感选项写入 `$HOME/.silvermoon/connector.yaml`。创建和更新必须原子进行，并在 POSIX 使用 `0600`、在 Windows 限制 ACL 为当前用户；读取前拒绝不安全权限。环境变量和显式 token 文件继续覆盖 profile，命令行仅保留运行选项，不再接受 connector ID 或显示名。

### I-S04: 收敛 API、UI 与兼容边界

API 以设备名称创建固定绑定的 token，并向 UI 返回设备元数据；UI 使用单一“Add device”卡片一次命名和复制配置，并在统一设备卡片中展示状态、session 与 token 操作。保留既有 connector/session 路由与环境变量覆盖以兼容已部署调用方；旧连接路径、header 及注册 payload 中的 connector ID/display name 继续接受但忽略，身份始终由 token 推导。文档明确 profile 优先级和旧参数迁移方式；successor-token 无缝升级不在本次实现范围。

## Acceptance criteria

### I-AC01: 身份与单连接约束可证明

自动化测试证明设备身份完全由服务端 token 绑定推导，客户端无法覆盖；重叠连接被稳定拒绝且既有连接继续工作，断线或租约失效后可重连，撤销会关闭对应连接。

### I-AC02: 历史归属保持连续

迁移与重连测试证明既有 agent session、事件和命令仍归属于同一稳定设备，D1/SQLite 外键保持有效；同一 token 映射多个 connector 时迁移以可操作错误失败，而非静默拆分或合并。

### I-AC03: 一次配置即可安全重启

UI、API 与 CLI 测试证明用户只在添加设备时命名一次；profile 尚不存在时可通过显式覆盖首次安全创建，写入后 connector 可无交互重启；已存在文件权限不安全时明确拒绝读取，日志不泄露 token，且客户端参数不能覆盖设备身份。

### I-AC04: 覆盖优先级与兼容迁移清晰

测试和文档证明 token 使用 `SILVERMOON_CONNECTION_TOKEN`、显式 token 文件、profile 的顺序解析，Relay 地址和非敏感选项使用显式参数或环境变量优先于 profile；新 CLI 对旧 `--id`、`--display-name` 与 `SILVERMOON_CONNECTOR_ID` 给出明确迁移错误，而 Relay 继续接受旧 connector 的路径、header 与注册字段并忽略其身份值。
