# Implementation

## Steps

### I-S01: 重组固定视口应用外壳

移除认证后页面的居中容器与外层 Panel，把产品界面改成 `100dvh` 的两行两列网格：上排是品牌与当前 Session metadata / account controls，下排是固定密度的 Session rail 与 `minmax(0, 1fr)` 工作区。认证后的产品表面必须边到边撑满视口，不设置页面 padding、max-width、外层圆角或阴影；Session rail 与 transcript 独立滚动，composer 固定在工作区底边。Composer 的内容容器与 transcript 使用相同最大宽度和水平内边距；textarea 与下方工具栏组成一个统一边框和 focus 状态的输入 surface，工具栏把真实的 Device 目标或运行反馈放在左侧、圆形发送按钮放在最右侧，不呈现尚无能力支持的假控件。Textarea 不提供鼠标拖拽 resize handle，而是随输入内容自动增高，达到 `10rem` 上限后才在输入区内部滚动。现有居中 Shell 只继续服务 loading 与 signed-out 状态。

左上区域展示 Relay mark 与产品名，右上区域展示当前 Session 标题、状态及 account trigger，左下区域承载 Session 发现和创建，右下区域承载当前 Session 的 transcript 与 composer。控件继续使用仓库中的 shadcn / Radix 组件和 Relay tokens，生产图标统一使用 Lucide，不保留文本 glyph。

### I-S02: 建立 Session-first 导航与工作流

并行加载所有 Connector 的 Agent Sessions，合并成按最近活动排序的一级列表，并以 `connectorId + sessionId` 作为 UI identity，避免不同 Device 下重复 Session ID 互相覆盖。每个 Session 列表项以 Device 标签表达唯一归属；事件读取、history sync 和命令发送必须继续只使用该 Session 的 Connector。显式选择通过 URL 同时持久化两个 ID，并可在加载和浏览器前进 / 后退时恢复。

列表提供标题 / Device 搜索以及 waiting、failed、gone、unknown 状态的 attention filter。创建 Session 使用聚焦 dialog，要求选择在线 Device，并保留标题和初始 prompt。内容区以 message event 为会话主线，以紧凑 activity row 表达 tool、status、error 等运行事件。已接受的创建和 follow-up command 通过 `/api/commands/{id}` 轮询到 success 或 failure，不能在命令真正完成前给出成功反馈。

### I-S03: 完成响应式与界面质量

窄屏默认展示 Session 列表，选择后进入全屏 Session 内容，并提供明确的返回列表操作；浏览器前进 / 后退遵循同一 list / detail 模型。Device、token、identity 和 browser-session 管理从主工作区移入 account menu 启动的 settings dialog。

补齐语义 label、键盘操作、可见焦点、颜色之外的状态文字、长内容换行与 reduced-motion 处理，并覆盖 loading、empty、offline、waiting、failed、sending 与 command failure 状态，不产生文档级横向滚动。`Shift+Enter` 换行提示只出现在可发送 textarea 的 placeholder 中，不额外占用输入框上方空间。本期不渲染空白第三栏、Inspector toggle 或 Inspector placeholder。

## Acceptance criteria

### I-AC01: 桌面工作区占满有效视口

代表性桌面视口中没有外层卡片留白或文档级横向滚动，品牌、Session metadata / account、Session list 和 Session content 四区撑满可用宽高，列表与 transcript 独立滚动且不移动应用外壳，composer 保持在内容区底部；composer 与消息流的内容宽度对齐，textarea 与工具栏共享完整输入边框和 focus 状态，工具栏最右侧提供发送按钮，输入内容增加和清空时 textarea 在最小高度与 `10rem` 上限之间自动调整且没有 resize handle；通过浏览器截图和布局断言证明。

### I-AC02: Session 语义与状态保持准确

多个 Device 的 Sessions 可从同一个一级列表发现，每个列表项只关联一个 Device，URL 能恢复同一 composite selection，选择 Session 后标题、状态、事件和命令目标一致且不会误用其他 Device；创建、发送、离线与失败状态通过针对性组件或集成测试证明。

### I-AC03: 窄屏操作与可访问性可用

390px 宽度下，Session 列表和专注内容是两个 focused view 而不是纵向长页，account settings 保持可达，浏览器导航在两个视图间行为可预测；常见 waiting、offline、failed、empty 和 command 状态可理解、可操作，键盘顺序、焦点可见性和可访问名称通过自动检查与浏览器走查证明。
