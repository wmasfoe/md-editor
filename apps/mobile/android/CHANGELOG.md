# Changelog - Inkpoint Android

All notable changes to the Inkpoint Android application will be documented in this file.

## 0.1.0 - 2026-09-16 (#69)

- **原生 Android 客户端首次发布**：基于 Jetpack Compose 与 AndroidX WebView 构建现代 Material Design 3 风格移动客户端
- **Material You 动态主题与沉浸式边缘到边缘 (Edge-to-Edge)**：支持系统深浅色模式切换、动态色彩适配与原生触摸反馈
- **CodeMirror 6 极速自绘编辑**：移动端专有触摸选区与弹簧手感工具栏，实现毫秒级响应的 Markdown / MDX 编辑体验
- **双向模式无缝流转**：支持所见即所得（WYSIWYG）与实时源码双模式自由切换
- **Markdown / MDX 官方全能扩展支持**：
  - 语法高亮、GFM 表格、LaTeX 公式（KaTeX）、图表（Mermaid）、提示块（Callout）以及容器指令原生离线支持
  - GFM 任务列表（Task Lists）原生排版优化，去除多余标记与断行，提供整洁的复选框列表交互
  - Mermaid 图表首屏及模式切换无缝水合，杜绝白屏与异步加载竞态
- **原生键盘交互工具栏**：提供常用 Markdown 语法与 MDX 组件一键插入与撤销/重做快捷控制
- **本地存储持久化与生命周期保护**：支持配置与草稿安全保存，应用恢复与多任务切换稳定可靠
- **实时文档大纲抽屉**：自动提取文档标题大纲，支持侧边快速滑动与跳转定位
