# Deployment

## Scope

旧 scope 下的 package 从未发布，不需要弃用或旧名称交接。本阶段暂不发包，
也不从 registry 安装尚未发布的新 package；不创建或修改发布凭据、组织权限
或生产资源。实际发布及发布后的外部安装验证留待后续明确授权。

## Steps

### D-S01: 只读核查组织与权限

只读检查 npm registry 可达性、当前认证状态和 `silvermoon-ai` 组织成员权限。
记录可确认的组织归属及维护者发布权限；没有认证或权限时明确记录阻塞，
不新增凭据或更改权限。

### D-S02: 验证现有生产自动化

查询包含迁移提交的 primary GitHub Actions quality gate，确认新 package selector
通过冻结锁文件安装、仓库检查和本地 D1 迁移。对现有 relay 执行只读健康检查，
不推送 release 分支，不触发生产部署。

## Acceptance criteria

### D-AC01: 组织权限已确认

npm registry 与认证查询成功，组织成员查询证明当前维护者属于
`silvermoon-ai` 且有发布权限。证据不得包含认证 token；认证或访问不足时
本项保持未完成。尚未发布 package 的 registry 所有权不作为本阶段证明要求。

### D-AC02: 现有自动化与服务可用

GitHub Actions run 的 commit 可追溯到包含迁移的 primary，quality gate 成功，
deployment job 未运行；现有 relay 健康端点返回 HTTP 200 与
`{"service":"silvermoon-relay","status":"ok"}`。以不可变 run 链接、commit 和
只读 HTTP 检查结果证明，实际发包与独立安装不在本项范围。
