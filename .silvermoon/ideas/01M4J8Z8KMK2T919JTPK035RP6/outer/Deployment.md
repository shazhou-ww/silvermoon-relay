# Deployment

## Scope

旧 scope 下的 package 从未发布，不需要弃用或旧名称交接。本阶段暂不发包，
也不从 registry 安装尚未发布的新 package；不创建或修改发布凭据、组织权限
或生产资源。组织成员发布权限、发布凭据、实际发布及发布后的外部安装验证
留待实际发包前核验和后续明确授权；当前不发包阶段不以 CLI 登录作为验收条件。

## Steps

### D-S01: 只读核查组织就绪

只读检查 npm registry 可达性和 `silvermoon-ai` 公开组织页面，
结合用户明确确认组织已由其创建，记录本阶段组织已就绪的证据。
保留 CLI 未认证及成员角色未独立验证的事实，不新增凭据或更改权限。

### D-S02: 验证现有生产自动化

查询包含迁移提交的 primary GitHub Actions quality gate，确认新 package selector
通过冻结锁文件安装、仓库检查和本地 D1 迁移。对现有 relay 执行只读健康检查，
不推送 release 分支，不触发生产部署。

## Acceptance criteria

### D-AC01: 组织就绪已确认

npm registry 连通性检查成功，公开组织页面显示 `silvermoon-ai`，且用户明确
确认组织已由其创建。以查询时间、页面 URL 与可见内容及用户确认证明；
不得将这些证据表述为已查询到成员角色或具备自动化发布权限。
尚未发布 package 的 registry 所有权不作为本阶段证明要求。

### D-AC02: 现有自动化与服务可用

GitHub Actions run 的 commit 可追溯到包含迁移的 primary，quality gate 成功，
deployment job 未运行；现有 relay 健康端点返回 HTTP 200 与
`{"service":"silvermoon-relay","status":"ok"}`。以不可变 run 链接、commit 和
只读 HTTP 检查结果证明，实际发包与独立安装不在本项范围。
