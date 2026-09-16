# Changelog - Inkpoint iOS

All notable changes to the Inkpoint iOS application will be documented in this file.

## 0.1.0 - 2026-09-16 (#69)

- **原生 iOS 客户端首次发布**：基于 SwiftUI 与 WKWebView 构建的高性能双向混合架构，专为 iPhone 与 iPad 量身定制
- **自适应暗黑模式与原生触控**：深度契合 Apple 人机界面指南（HIG），支持深浅主题无缝切换与触感反馈（Haptic Feedback）
- **CodeMirror 6 极速自绘编辑**：移动端专有触摸选区优化，单状态栈实现毫秒级响应的 Markdown / MDX 极速编辑
- **双向模式无缝流转**：支持所见即所得（WYSIWYG）与实时源码双模式零延迟自由切换
- **Markdown / MDX 官方全能扩展支持**：
  - 语法高亮、GFM 表格、LaTeX 公式（KaTeX）、图表（Mermaid）、提示块（Callout）以及自定义容器指令全量离线支持
  - GFM 任务列表（Task Lists）原生渲染优化，去除冗余标记，对齐复选框与悬挂缩进排版
  - Mermaid 离线异步渲染与阅读/编辑双向模式无闪烁水合（Hydration）
- **原生键盘浮动工具栏与快捷插入**：支持一键插入粗体、斜体、列表、代码块、数学公式、引用与容器指令
- **离线即时存储与状态恢复**：文档内容即时持久化，支持应用切后台或冷启动无缝还原
- **实时文档大纲（Outline Drawer）**：自动提取文档层级标题并支持平滑滑动抽屉快速跳转
