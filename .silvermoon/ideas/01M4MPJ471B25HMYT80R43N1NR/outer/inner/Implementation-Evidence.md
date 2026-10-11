# Implementation Evidence

## 变更对应

- `I-S01`：Connector 保留 archived Agent Host Session 与只读 history binding；parent 和 subsession 均映射为 `closed`、`canSendMessage=false`，并补充映射回归测试。
- `I-S02`：Worker migration 增加 `history_synced_at`；成功 history command 与同步标记使用 D1 batch 更新，状态变化不再参与 freshness 判断。
- `I-S03`：Web 跟踪异步 history command，保留 Relay events 展示，并提供归档只读说明、失败原因和 Retry sync；补充纯函数与 Playwright 场景。

## 本地验证

- `git diff --check`：通过。
- TypeScript 5.9.3 `transpileModule`：9 个受影响 TS/TSX 文件无语法诊断。
- SQLite 内存验证：history command 成功后设置独立同步标记；Session 后续更新为 `gone` 时标记保持有效。
- UI review bundle：桌面与 390px 窄屏均无横向溢出，场景可直接打开。

## CI 证明

隔离 worktree 遵守“不安装依赖”约束，且其他 checkout 的 pnpm links 指向已不存在的 store，因此本地未安装依赖。primary 提交 `5f1793f` 的 [Check and deploy run 38115493381](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38115493381) 通过：

- `pnpm check`：通过，覆盖 Connector 与 Worker 回归测试、TypeScript 与 lint。
- `pnpm --filter @silvermoon-ai/web test:browser`：通过，覆盖已存历史、异步失败和 Retry sync 场景。
- `pnpm --filter @silvermoon-ai/worker d1:migrate:local`：通过，验证 `0009_agent_session_history_sync.sql`。
