# 将 Relay 重构为 Session-first 工作区

## 问题

当前 Web UI 以 Device、Session、Activity 三栏逐级展开，页面外层还承载账户设置，导致主工作区松散、窄屏需要跨越长页面才能回到当前 Session，输入与运行上下文也容易离开视野。

## 结果

用户进入 Relay 后以具体 Agent Session 为一级导航对象，在固定视口的两行两列工作区中浏览 Session 列表、查看标题与状态、阅读内容并从底部输入框继续对话。Device 作为每个 Session 唯一归属的标签和筛选维度，不再占据一级导航。

## 边界

- 一个 Agent Session 仍且只属于一个 Device；本 idea 不改变领域关系、Relay 协议或持久化模型。
- 用户菜单只重组账户、安全与高级功能的入口，不重新定义这些功能。
- 右侧文件或 review Inspector 仅保留未来扩展边界，本期不实现第三栏及其交互。

## 验收标准

- [UI 变更评审](./ui-review/index.html)以等价数据展示当前 Device-first 界面与拟议 Session-first 工作区，足以判断桌面和窄屏的布局方向。
- 主视图中 Session 列表、当前标题与状态、可滚动内容和固定底部输入框形成连续工作流，Device 以标签表达唯一归属。
- 桌面有效利用可用视口；窄屏选择 Session 后进入专注内容视图，不再依次堆叠 Device、Session 与内容区域。
