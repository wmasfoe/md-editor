# Changelog - Web Playground

All notable changes to the Inkpoint Web Playground will be documented in this file.

## 0.1.0 - 2026-09-09

- 首次发布 Inkpoint Web 在线体验版（Playground）
- 采用与桌面端同构的单 CodeMirror 6 状态栈架构，零延迟切换所见即所得（WYSIWYG）与源码编辑模式
- 内置 MDX 官方交互组件（提示块 Callout、代码高亮、GFM 表格、任务列表），开箱即用
- 极简全宽画布设计，去除文件树，聚焦纯粹写作体验
- 顶栏轻量集成明暗主题切换与偏好设置弹窗（100% 对齐桌面端配置面板）
- 纯前端通过原生 fetch 接入 OpenAI 兼容 API / DeepSeek，支持光标处行内幽灵文本（Ghost Text）续写
- 基于 localStorage 实现网页端草稿自动持久化与误关恢复
- 集成实时更新的大纲目录（TOC）滑动抽屉，支持快捷键快速定位跳转
