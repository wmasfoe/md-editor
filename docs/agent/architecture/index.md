# 架构文档目录

用途：记录技术方案、模块边界、能力边界、编辑器核心模型和插件架构。改动核心编辑链路、MDX、Raw 保真、插件系统、AI 接入或跨包接口时先读本目录。

## 文档

- 技术方案： [markdown_editor_technical_plan.md](./markdown_editor_technical_plan.md)
- 能力边界设计原则： [capability_boundary_design_principles.md](./capability_boundary_design_principles.md)
- Desktop Store 与 Controller 边界规范： [desktop_store_controller_boundary.md](./desktop_store_controller_boundary.md)
- Hooks 迁移到 React-facing 层与 editor-core 平台依赖清理手册： [hooks-migration-to-editor-core.md](./hooks-migration-to-editor-core.md)
- macOS 窗口 Chrome 规范： [macos_window_chrome_guidelines.md](./macos_window_chrome_guidelines.md)
- MDX 组件插件分层方案： [mdx_component_plugin_architecture.md](./mdx_component_plugin_architecture.md)
- 本地小模型接入方案： [local_ai_model_integration_plan.md](./local_ai_model_integration_plan.md)
- Desktop Editor Actions Context（Provider 依赖型动作的组织规范）： [desktop_editor_actions_context.md](./desktop_editor_actions_context.md)
- WYSIWYG 内联可删除语法标记（路线 D）+ 编辑器视觉优化实施文档： [inline_syntax_markers_and_visual_refresh.md](./inline_syntax_markers_and_visual_refresh.md)
- 自研 Markdown 渲染器架构方案（CodeMirror 6 底座，方案讨论阶段）： [custom_markdown_renderer_architecture.md](./custom_markdown_renderer_architecture.md)
