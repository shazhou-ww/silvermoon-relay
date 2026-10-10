# Implementation

## Steps

### I-S01: 重组固定视口应用外壳

将认证后页面重组为品牌区、Session metadata、Session 列表和 Session 内容四个对齐区域；保持现有身份、Connector、Session 和事件 API 行为不变。

### I-S02: 建立 Session-first 导航与工作流

把 Agent Session 提升为一级列表项，以 Device 标签表达唯一归属，并将标题、状态、内容流、命令反馈和底部输入框接成连续操作路径。

### I-S03: 完成响应式与界面质量

为窄屏提供列表与 Session 专注视图的导航，补齐 URL 状态、键盘焦点、可访问名称、长内容、空态、离线态和失败态。

## Acceptance criteria

### I-AC01: 桌面工作区占满有效视口

代表性桌面视口中没有文档级横向滚动，Session 列表与内容区独立滚动，输入框保持在内容区底部；通过浏览器截图和布局断言证明。

### I-AC02: Session 语义与状态保持准确

每个列表项只关联一个 Device，选择 Session 后标题、状态、事件和发送目标一致；创建、发送、离线与失败状态通过针对性组件或集成测试证明。

### I-AC03: 窄屏操作与可访问性可用

窄屏可在 Session 列表和专注内容视图之间导航，当前 Session 可由 URL 恢复，键盘顺序、焦点可见性和可访问名称通过自动检查与浏览器走查证明。
