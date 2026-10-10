# Subsession 部署证据

## 发布基线

- 部署契约先同步至 primary commit
  `83fcbcdce46e7448baf56b0e333ba46e5ebf2e88`，Silvermoon 观察到
  `deploymentRevision=02b175b93caf` 后才执行发布。
- primary quality gate
  [run 38048922111](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38048922111)
  成功；其 head 为上述 commit。
- 使用普通 merge 将该 primary 合入 `release`，得到 release commit
  `c0471854668e752a503c97a35e8a6188c8e624eb`。未 rebase、force push
  或改写 release 历史。

## Release workflow

[run 38049004097](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38049004097)
在 release commit `c0471854668e` 上完成，`check` 与 `deploy` jobs 均为
`success`：

- 冻结 lockfile 安装、完整 `pnpm check` 与本地 D1 migration 全部成功。
- 远端 D1 明确列出并成功应用 `0006_session_hierarchy.sql`，执行 4 条命令，
  migration 状态为成功。
- Worker `silvermoon-relay` 部署成功，version ID 为
  `20dda09b-8e89-4cb9-a42f-9d74088263e3`。
- Pages 部署成功，不可变 deployment URL 为
  `https://243d8d94.silvermoon-work.pages.dev`。

## Connector 产物

在 primary commit `83fcbcdce46e` 上执行：

- Connector 单元测试：3 个文件、14 项测试全部通过。
- Connector TypeScript 检查通过。
- Connector 构建与声明文件生成通过。
- `pnpm --filter @silvermoon-ai/connector pack` 成功生成
  `silvermoon-ai-connector-0.1.0.tgz`；SHA-256 为
  `8540AF1E1AF7CB9BC639DF6693D9AB4390FA2C4A10A663EA0CBF4408CE5DDC5F`。

该 tarball 仅用于核验。根据 [Deployment.md](./Deployment.md) 的范围，本阶段没有
修改 package version、没有覆盖 npm 上现有 `0.1.0`，也没有执行 npm publish。

## 生产可用性

2026-10-10T11:38:07Z 执行只读检查：

- `https://relay.silvermoon.work/health` 返回 HTTP 200 与
  `{"service":"silvermoon-relay","status":"ok"}`。
- `https://silvermoon.work/` 返回 HTTP 200。
- 不可变 Pages deployment URL 返回 HTTP 200。

## 尚待真实 Device 冒烟

当前环境没有 `SILVERMOON_CONNECTION_TOKEN`、
`SILVERMOON_CONNECTION_TOKEN_FILE` 或已登录 Web session。没有读取、创建或
绕过生产凭据，因此无法脱敏查询真实 Session API 或截取父子列表界面。

`D-S01` 已完成。`D-S02`、`D-AC01` 与需要真实目录多次刷新的 `D-AC02`
保持未完成，不能把健康检查或自动化测试表述为真实 Device 冒烟。
