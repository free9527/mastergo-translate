---
name: ui-apple-style
description: UI design system — Apple minimalist style with consistent color tokens and component patterns
metadata:
  type: reference
---

# UI 设计规范

## 设计系统
Apple 简约风，配色与原 UI 一致。

### CSS 变量
```css
--blue: #007AFF          /* 主色调 */
--green: #34C759          /* 翻译/成功 */
--orange: #FF9500          /* 校对/警告 */
--red: #FF3B30             /* 错误 */
--gray-50: #F5F5F7         /* 背景 */
--gray-100: #E5E5EA        /* 次要背景 */
--gray-200: #D1D1D6        /* 边框 */
--gray-400: #86868B        /* 次要文字 */
--gray-600: #636366        /* 正文 */
--gray-800: #2C2C2E        /* 标题 */
--gray-900: #1D1D1F        /* 主要文字 */
--radius-sm: 8px
--radius: 10px
--radius-lg: 14px
```

### 暗色模式
`.app.dark` 覆盖所有 CSS 变量，背景 `#000` / `#1C1C1E`。

### 字体
`-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, sans-serif`

### 组件模式
- `.btn` — 基础按钮（primary/accent/secondary/ghost/warning）
- `.section` — 可折叠面板（header + body）
- `.field` / `.field-label` — 表单字段
- `.toolbar` — 白色卡片圆角容器
- `.toast` — 毛玻璃底部通知
- `.progress-wrap` — 进度条
- `.toggle` — 开关

**Why:** 所有 UI 改动必须遵循此设计系统，保持视觉一致性。[[matergo-translate-plugin]]