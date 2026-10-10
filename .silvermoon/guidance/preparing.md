# Preparing 阶段的评审支持材料

准备每个 idea 时，先根据实际变更判断以下评审是否适用。只在适用时创建产物；不适用时不要添加占位文件。两类变更可以同时适用。

## UI 变更

当 idea 会改变现有用户界面的页面、工作流、状态、布局或交互时：

1. 使用仓库中的 `ui-change-review` Skill，在该 idea 的 Ideal World 中创建 `ui-review/`，按 Skill 的模板提供可直接打开的 `index.html` 和必要的场景文件。
2. Before 必须基于当前源码、截图或可运行界面；Before 与 After 使用等价的数据、视口、外壳和比例。只展示影响评审决定的流程与状态。
3. 在 `Idea.md` 中保持方向卡简洁，只记录需要批准的 UI 决定、相关边界或验收结果，并链接 `ui-review/index.html`。具体视觉差异、场景和 callout 留在支持材料中。
4. 明确该 bundle 是说明性的评审材料，不是生产 UI 或规范性行为契约。提交 Ideal World 前，实际打开并检查桌面、窄屏和每个场景。

## Business model 变更

当 idea 会改变领域实体、所有权、关系、键、生命周期、迁移或兼容性时：

1. 使用仓库中的 `business-data-model-review` Skill，在该 idea 的 Ideal World 中创建 `Business-Data-Model-Review.md`。
2. 支持文档应包含待批准的决定、Current / Proposed / Why、带基数和关系动词的目标 Mermaid ER 图、适用实体的生命周期语义与关键不变量，以及迁移、兼容性和未决事项。
3. 在 `Idea.md` 中只保留会影响方向批准的业务模型边界、验收结果和支持文档链接；不要把完整 schema、DDL 或实施方案复制进方向卡。
4. 提交 Ideal World 前，渲染 Mermaid，并将图中的身份、所有权、关系和迁移语义与当前源码及持久化模型交叉核对。

由这些评审产生的实施或部署要求，应进入对应的 `Implementation.md` 或 `Deployment.md` preparation seed，并使用稳定 ID 同步到 `ledger.md`；不要把评审说明或证据写进 ledger。
