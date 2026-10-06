# Deployment

## Steps

### D-S01: 配置最小权限部署凭据

从本机 `cfg` 安全读取 Cloudflare API token 与 account ID，通过标准输入写入仓库
GitHub Actions secrets。任何命令输出、Git 历史、日志或构建产物都不得包含凭据值；
只验证 secret 名称存在。

### D-S02: 创建 Cloudflare dummy 资源

使用 Wrangler 在目标账户创建 `silvermoon-relay` D1 database 和
`silvermoon-work` Pages project，把真实 D1 database ID 写入已审查的
`wrangler.jsonc`，并保持 Worker custom domain 为 `relay.silvermoon.work`。
重复执行前先查询现有资源，避免产生重复对象。

### D-S03: 通过 release merge 触发首次部署

在远端创建不含部署工作流的 `release` 基线分支，然后通过 GitHub pull request
把已验证的 `main` 合并到 `release`。该 merge push 必须触发仓库 workflow，
依次运行质量门禁、D1 migration、Worker/DO deploy 和 Pages deploy；不直接从本地
绕过 workflow 发布应用。

### D-S04: 绑定域名并验证 dummy service

确认 `silvermoon.work` 已绑定到 `silvermoon-work` Pages project，
`relay.silvermoon.work` 已作为 Worker custom domain 生效。通过公开 HTTPS 请求
验证 Pages 返回 Silvermoon Relay 应用、`/health` 返回预期 JSON，并检查 workflow
日志未暴露 secret。

### D-S05: 固化部署证据与恢复路径

记录 workflow run、部署 commit、Pages deployment、Worker version、D1 migration
状态和公开健康检查结果。确认失败时可从 GitHub Actions 重跑相同 commit，且不需
改写 `main` 或 `release` 历史。

## Acceptance criteria

### D-AC01: GitHub secrets 已安全配置

`gh secret list` 显示 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，但仓库、
workflow 输出和 Agent 报告中不存在其值；以 secret 名称列表和凭据扫描证明。

### D-AC02: release merge workflow 成功

由合并到 `release` 产生的 GitHub Actions run 全部 jobs 以 success 结束，日志证明
冻结安装、质量门禁、远端 D1 migration、Worker deploy 和 Pages deploy 均执行，
且部署 commit 等于 release merge commit。

### D-AC03: Worker 与数据资源在线

Cloudflare 资源查询显示 `silvermoon-relay` Worker、SQLite-backed
`DaemonSession` migration 和 D1 database 存在；访问
`https://relay.silvermoon.work/health` 得到 HTTP 200 与
`{"service":"silvermoon-relay","status":"ok"}`。

### D-AC04: Pages 与主域名在线

Pages deployment 状态为成功，`https://silvermoon.work` 返回 HTTP 200，页面标题为
`Silvermoon Relay`，正文包含 WSS relay endpoint；通过 Pages deployment 查询和
公开浏览器/HTTP 检查证明。

### D-AC05: dummy 部署可重复且无秘密

相同 release commit 的 workflow 可安全重跑而不会重复创建 D1/Pages 资源或破坏
schema；仓库与构建产物的 secret 扫描无真实凭据，Cloudflare 与 GitHub 日志只含
资源标识和掩码值。
