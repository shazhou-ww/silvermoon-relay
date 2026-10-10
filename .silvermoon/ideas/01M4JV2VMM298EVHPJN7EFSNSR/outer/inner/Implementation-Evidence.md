# 消息流滚动实施验证

验证日期：2026-10-10。环境：Windows、真实 Chromium；relay API 使用本地测试拦截，不访问生产账户或生产数据。以下证据用于 Implementation 审阅，不代表线上部署或人工验收。

## 行为及证明

| 标准 | 证明 |
| --- | --- |
| I-AC01 | 首次历史、延迟历史、同名跨 Device 切换、64px 跟随阈值、流式快照、延迟媒体及消息区尺寸变化均由浏览器断言验证；定位后距底部不超过 1 CSS px。 |
| I-AC02 | 在历史位置追加消息、空轮询、筛选下方工具消息、断开/恢复连接、流式更新及增加底部媒体高度后，测试断言 scrollTop 未变化；移动端返回列表后恢复阅读位置。 |
| I-AC03 | 三个视口验证按钮名称、关联消息区、44px 最小高度、键盘顺序、Enter 激活、焦点移交、即时隐藏及减少动态效果；几何断言证明按钮不与消息视口或输入区重叠。 |

消息区距底部不超过 64 CSS px 时自动跟随；65px 时显示返回按钮。固定的 4rem 控件区域避免浮动按钮覆盖正在阅读的文字，同时避免按钮显隐引发布局跳动。短会话不显示无必要的控件。系统未要求减少动态效果时，主动返回使用平滑滚动，并允许用户中断。

回归过程中发现并修复延迟媒体尺寸变化时的竞态：布局变化触发的旧滚动事件可能在 ResizeObserver 回调之前错误地取消跟随。现在通过记录已处理的布局尺寸，避免这类事件覆盖原跟随意图。

## 可复现检查

在仓库根目录执行：

```powershell
pnpm --filter @silvermoon-ai/web exec playwright install chromium
pnpm --filter @silvermoon-ai/web test:browser
pnpm --filter @silvermoon-ai/web test:browser --grep 'structured|layout changes' --repeat-each 3
pnpm --filter @silvermoon-ai/web typecheck
pnpm exec oxlint apps\web
pnpm --filter @silvermoon-ai/web test
pnpm --filter @silvermoon-ai/web build
```

- 浏览器回归：8 个场景 × 3 个视口，共 24 项通过。桌面为 1440×900，移动端为 390×664，窄屏为 320×640 CSS px。
- 布局/流式竞态重复验证：2 个场景 × 3 个视口 × 3 次，共 18 项通过。
- 现有 Web 单元测试：2 个文件、6 项通过。
- Web 类型检查、生产构建及 lint 通过，无新错误。lint 保留现有 Button/Badge 的 Fast Refresh 导出警告；构建保留主 JS chunk 超过 500 kB 的大小提示。
- CI check job 增加 Chromium 安装及相同的浏览器回归命令，现有仓库检查不变。

## 视觉检查

以下截图来自上述浏览器回归，已打开检查桌面、移动和最窄视口的历史阅读状态及返回后的最新位置；不是生产截图。

| 视口 | 历史阅读 | 返回最新 |
| --- | --- | --- |
| 桌面 | [截图](./evidence/desktop-history.png) | [截图](./evidence/desktop-latest.png) |
| 移动端 | [截图](./evidence/mobile-history.png) | [截图](./evidence/mobile-latest.png) |
| 320px 窄屏 | [截图](./evidence/narrow-history.png) | [截图](./evidence/narrow-latest.png) |

## 范围与限制

不改变事件顺序、工具消息投影、输入发送行为、API、数据模型或运行时配置。工具内容移除时仍使用浏览器的原生滚动锚定和合法范围裁剪；测试证明没有主动返回底部，但不承诺被移除内容的原数值位置仍然存在。

移动端测试使用 Chromium 的触摸/设备模拟，不等同于真实 iOS Safari 或屏幕阅读器认证。生产长会话与线上 smoke 检查仍属于尚未执行的 Deployment 阶段。
