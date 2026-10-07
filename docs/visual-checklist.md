# UI 验收

- 高频属性前置，负责人主头像、参与人弱头像。
- 48px rail / 232px context nav / 48px toolbar / 560px peek。
- Board 状态、优先级、负责人、日期可扫读。
- Dialog/Popover 使用 Radix 焦点管理；键盘导航、loading/error/empty/disabled 完整。
- 测试 390 / 1280 / 1440 / 1920；移动端仅 Board 内容横向滚动。
- 截图基线覆盖 My、Board、Peek、Full Detail；无渐变、发光、装饰 KPI。

## 本次审查

已查看 Board desktop 和 Peek mobile 截图，检查了状态/责任/日期的扫读、头像层级、工作台密度、低饱和语义色、边框/圆角与手机满宽 Peek。Playwright 保存并复测 8 张关键页面基线，测试了焦点 trap、reduced motion、4 档窗口宽度与 1,000 卡片虚拟化。未进行真实用户可用性研究或屏幕阅读器全量人工测试。
