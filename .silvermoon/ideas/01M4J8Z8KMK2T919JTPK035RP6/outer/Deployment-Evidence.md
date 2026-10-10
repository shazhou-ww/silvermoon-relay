# 不发包部署检查证据

## 核查基线

- 用户明确说明旧 package 从未发布，并要求暂不发包、不包含旧包弃用。
- 更新后的 [Deployment.md](./Deployment.md) 先同步到 primary commit
  `57fbfb4802a364dc29a215223af934e16775be47`，Silvermoon 重新观察到
  `deploymentRevision=eb6c32306beb` 后才执行以下检查。
- 没有修改已验收的 Inner World 或 Ideal World；本文件补充 Outer World
  证据，会形成新的 deployment revision。以下历史核查基线后来按不发包
  范围调整，当前验收依据以“当前不发包范围的完成证据”为准。

## 当前不发包范围的完成证据

调整后的 [Deployment.md](./Deployment.md) 已先同步至 primary commit
`6c9ccfbb64c0d05c170c5c3f2dbfe8ba767fdab0`，重新观察到
`deploymentRevision=8787e0bdca78` 后执行当前检查：

- 2026-10-10 07:55 UTC 只读读取 npm 公开组织页面
  `https://www.npmjs.com/org/silvermoon-ai`，页面标题为 `npm | Profile`，
  主标题为 `silvermoon-ai`，显示 `Packages 0`。页面已正常显示组织资料，
  不再停留在先前的安全验证提示。
- 用户于 2026-10-10 07:47 UTC 明确确认该组织已由其创建。结合公开
  页面，组织已创建且可见有据；`Packages 0` 只说明该组织当前公开
  package 列表为空，不推断其他 scope 的历史发布情况。
- `2026-10-10T07:55:38.9395799Z` 开始执行 npm registry ping，退出码 0，
  PONG 646ms。
- `2026-10-10T07:55:50.7916737Z` 复查
  `https://relay.silvermoon.work/health`，HTTP 200，响应仍为
  `{"service":"silvermoon-relay","status":"ok"}`。
- 已验证下述成功 CI run 的 head 仍可从当前 primary 到达；当前仅修改
  Outer World 契约、证据和 ledger，未修改该 run 验证的应用或工作流。
- **当前 D-S01、D-S02、D-AC01、D-AC02 均已满足。** D-AC01 的现行
  含义是组织就绪，不再声称已验证成员发布权限。npm CLI 未认证、公开
  页面显示 `Sign In`、实际成员角色未独立查询的事实保持不变。
- 成员发布权限、凭据可用性、实际发布和独立安装验证延期到实际发包前。
  当前阶段的完成不表示这些延期检查通过，也不授权发布。

## 历史核查：组织与发布权限

2026-10-10 07:43 UTC 执行：

```text
npm ping --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

- Registry ping 成功，退出码 0，PONG 646ms。
- 身份查询返回 `ENEEDAUTH`，退出码 1；当前执行环境没有可用的 npm
  登录身份。
- 因身份查询失败，没有继续执行需要认证的组织成员查询，没有尝试登录、
  创建 token 或修改权限，也没有读取或记录任何认证 token。
- **D-S01 已执行；D-AC01 尚未满足。** Registry 可达不能证明
  `silvermoon-ai` 组织归属或维护者发布权限。后续需要在已获授权的 npm
  登录环境中执行只读 `npm org ls silvermoon-ai --json`，确认实际成员角色。

### 组织创建确认与复核

2026-10-10 07:47 UTC，用户明确确认 `silvermoon-ai` 组织已由其创建。
这是组织已创建的用户确认，不是 registry 成员角色查询结果，也不是发布授权。

随后再次只读核查：

- `npm whoami --registry=https://registry.npmjs.org/` 仍返回 `ENEEDAUTH`，
  退出码 1，未执行需要认证的组织成员查询。
- 访问 `https://www.npmjs.com/org/silvermoon-ai` 返回 HTTP 403；在浏览器
  中打开同一公开页面显示 `Performing security verification`，没有取得
  组织资料或成员角色。未尝试绕过安全验证。
- 这些结果不表示组织不存在。已知信息是用户确认组织已创建；当前环境
  仍无法独立确认实际成员角色，因此 D-AC01 保持未完成。

## D-S02 / D-AC02：primary CI

只读查询 [GitHub Actions run 38035247056](https://github.com/shazhou-ww/silvermoon-ai/actions/runs/38035247056)：

- Workflow：`Check and deploy`，event：`push`，branch：`main`。
- Head commit：`574cdd0b3789a923edd56e0b9fa03b9b7666dc5a`。
- `git merge-base --is-ancestor` 证明迁移提交
  `276f58502748577443d552aecda7f70892158b65` 包含在该 head 中，且该
  head 可从已刷新的 `origin/main` 到达，两个 ancestry 检查退出码均为 0。
- Run 为 `completed/success`，check job 为 `success`，结束于
  `2026-10-10T07:41:24Z`。
- 以下 steps 均为 `success`：
  - `pnpm install --frozen-lockfile`
  - `pnpm check`
  - `pnpm --filter @silvermoon-ai/worker d1:migrate:local`
- deploy job 为 `skipped`，没有生产部署 steps。

该 run 验证的是已迁移的生产自动化代码，不以随后仅修改部署文档的 run
替代或推断其质量门结果。

## D-S02 / D-AC02：现有 relay 健康

在 `2026-10-10T07:43:23.8269390Z` 对
`https://relay.silvermoon.work/health` 执行只读 GET：

```text
HTTP 200
{"service":"silvermoon-relay","status":"ok"}
```

检查明确校验 HTTP 状态、`service` 和 `status` 字段；**D-AC02 已满足**。
这是既有线上 relay 的健康证据，不声称新 package 已发布或安装。

## 未执行的外部变更

没有执行 package 发布、弃用、组织权限或凭据修改；没有推送 release
分支，没有触发生产部署。当前不发包范围的全部 criteria 已有证据；
同步本证据后可为准确 revision 提交 `submitOuter`，人工验收另行决定。
