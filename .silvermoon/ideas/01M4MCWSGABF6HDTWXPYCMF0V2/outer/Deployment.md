# Deployment

## Steps

### D-S01: 分阶段迁移设备身份

先发布 Relay、数据迁移和添加设备界面，在淘汰旧参数前确认活跃设备已完成绑定、凭据已安全迁移且无歧义数据。旧 connector 的连接路径、header 与注册字段继续接受但忽略，身份由 token 绑定推导。简化后的 connector 从源码构建用于本次验证，其 npm `0.2.0` 发布明确移出本次部署，并记录到 connector changelog 供后续版本统一发布。

### D-S02: 验证生产连接生命周期

使用从已验收源码构建的 connector，在真实部署中验证首次连接、重叠连接拒绝、正常重连、租约超时和撤销，并确认 dashboard 与会话操作始终指向同一设备。

## Acceptance criteria

### D-AC01: 既有设备无身份断裂

部署记录与生产抽查证明既有设备、session 和事件在迁移前后保持相同归属；旧 connector 即使继续发送 ID 与显示名也能连接，但这些值不能覆盖 token 绑定身份；无法自动迁移的歧义项在发布前被明确列出并处理。

### D-AC02: 单连接策略在 Relay 生效

外部验证证明同一 token 的第二条并发连接收到稳定错误且第一条连接可继续执行命令；第一条连接结束或租约过期后，新连接能够成功接管。

### D-AC03: 新设备可从安全 profile 重启

从生产 dashboard 添加一个设备并完成首次配置后，connector 可从 `$HOME/.silvermoon/connector.yaml` 无交互重启，并看到服务端名称、在线状态及其 session；检查 profile 仅对当前用户可读，权限放宽后 connector 明确拒绝读取。
