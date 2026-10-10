# 实施验证证据

验证日期：2026-10-10

## Scope 与工作区边界

- `pnpm list -r --depth -1 --json` 识别到
  `@silvermoon-ai/connector`、`@silvermoon-ai/protocol`、
  `@silvermoon-ai/rpc`、`@silvermoon-ai/worker` 和
  `@silvermoon-ai/web`。
- 清单中只有 `@silvermoon-ai/connector` 为非 private package；
  `protocol`、`rpc`、`worker`、`web` 以及 workspace root 均保留
  `private: true`。
- 对 `.silvermoon` 历史记录以外的仓库内容搜索
  `@silvermoon-relay/`，旧 scope 只出现在 README 的
  `Package scope migration` 明确迁移表中。
- canonical repository 旧地址
  `github.com/shazhou-ww/silvermoon-relay` 未出现在活动源码、配置或普通
  文档中。

## 安装与质量门

- `pnpm install --frozen-lockfile`：通过，锁文件与全部 6 个 workspace
  project 一致。
- 定向运行 protocol、connector 和 worker 测试：3 个 test file、
  25 个测试全部通过。
- `pnpm check`：lint、全 workspace typecheck、25 个测试和全 workspace
  build 全部通过。Lint 保留两个未由本次迁移引入的 React Fast Refresh
  warning，没有 error。
- `pnpm --filter @silvermoon-ai/worker d1:migrate:local`：通过，
  `0001_initial.sql` 至 `0005_session_history_commands.sql` 全部成功应用，
  证明工作流使用的新 package selector 可执行。
- `node .\packages\connector\dist\cli.js --help`：通过，CLI 仍以
  `silvermoon-connector` 显示帮助和兼容选项。

## 发布产物预览

- `pnpm --filter @silvermoon-ai/connector pack`：成功生成
  `silvermoon-ai-connector-0.1.0.tgz`。
- tarball manifest 的名称为 `@silvermoon-ai/connector`，repository 为
  `https://github.com/shazhou-ww/silvermoon-ai.git`，publish access 为
  `public`，registry 为 `https://registry.npmjs.org/`。
- tarball manifest 中的内部依赖为 `@silvermoon-ai/protocol` 和
  `@silvermoon-ai/rpc`，不含旧 scope；可执行文件名仍为
  `silvermoon-connector`。
- tarball 只包含编译后的 `dist`、`package.json` 和 `README.md`，未包含
  源码、测试或私有应用 package。
