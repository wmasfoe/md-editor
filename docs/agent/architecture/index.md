# 架构文档目录

用途：记录技术方案、模块边界、能力边界、编辑器核心模型和插件架构。改动核心编辑链路、MDX、Raw 保真、插件系统、AI 接入或跨包接口时先读本目录。

## 文档

- 技术方案（文件、状态等通用边界继续有效；编辑器内核以 CM6 专项方案为准）： [markdown_editor_technical_plan.md](./markdown_editor_technical_plan.md)
- 能力边界设计原则： [capability_boundary_design_principles.md](./capability_boundary_design_principles.md)
- Desktop Store 与 Controller 边界规范： [desktop_store_controller_boundary.md](./desktop_store_controller_boundary.md)
- Hooks 迁移到 React-facing 层与 editor-core 平台依赖清理手册： [hooks-migration-to-editor-core.md](./hooks-migration-to-editor-core.md)
- macOS 窗口 Chrome 规范： [macos_window_chrome_guidelines.md](./macos_window_chrome_guidelines.md)
- MDX 官方组件分层方案： [mdx_component_plugin_architecture.md](./mdx_component_plugin_architecture.md)
- 本地小模型接入方案： [local_ai_model_integration_plan.md](./local_ai_model_integration_plan.md)
- Desktop Editor Actions Context（Provider 依赖型动作的组织规范）： [desktop_editor_actions_context.md](./desktop_editor_actions_context.md)
- WYSIWYG 内联可删除语法标记（Milkdown 路线 D 历史实现）+ 编辑器视觉优化记录： [inline_syntax_markers_and_visual_refresh.md](./inline_syntax_markers_and_visual_refresh.md)
- CodeMirror 6 Markdown 可视化编辑器架构方案（权威目标；S1/M0 CM6-only beta 已可用，完整可视化迁移未完成）： [custom_markdown_renderer_architecture.md](./custom_markdown_renderer_architecture.md)
