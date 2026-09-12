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
- 端侧专属小模型 (SLM) 紧凑协议与客户端对接规范： [slm_compact_protocol_and_client_integration.md](./slm_compact_protocol_and_client_integration.md)
- Desktop Editor Actions Context（Provider 依赖型动作的组织规范）： [desktop_editor_actions_context.md](./desktop_editor_actions_context.md)
- WYSIWYG 内联可删除语法标记（Milkdown 路线 D 历史实现）+ 编辑器视觉优化记录： [inline_syntax_markers_and_visual_refresh.md](./inline_syntax_markers_and_visual_refresh.md)
- CodeMirror 6 Markdown 可视化编辑器架构方案（权威目标；S1/M0 beta，M1/S2、M1-FM/S5-FM-only 与 M2/S3 已验证；M3-M6 仍未完成）： [custom_markdown_renderer_architecture.md](./custom_markdown_renderer_architecture.md)
- Linux 与 Windows 平台支持、ARM 架构与终端一键安装方案： [cross_platform_support_plan.md](./cross_platform_support_plan.md)
- Web 端（Playground 体验版）架构方案： [web_app_architecture_plan.md](./web_app_architecture_plan.md)
- Markdown 语法插件架构（文本高亮、容器指令、LaTeX 数学公式与 Mermaid 图表方案）： [markdown_syntax_plugin_architecture.md](./markdown_syntax_plugin_architecture.md)
  记录 Markdown 扩展语法插件规范（MarkdownSyntaxPlugin）、@md-editor/syntax-plugins 架构、highlightPlugin（==高亮==）、containerDirectivePlugin、mathPlugin（KaTeX）与 mermaidPlugin 的按需/异步加载、Lezer 语法拦截、所见即所得就地编辑契约与降级隔离设计。
- macOS Quick Look 快速预览扩展架构方案： [macos_quicklook_preview_architecture.md](./macos_quicklook_preview_architecture.md)
  记录系统接入边界、JavaScriptCore 离线渲染沙箱、与 @md-editor/renderer-codemirror/static 共享静态渲染能力的复用设计以及构建流水线规范。

- 本地 AI 任务、模型档位与 Adapter 架构方案： [local_ai_task_adapter_architecture.md](./local_ai_task_adapter_architecture.md)
  记录单一启用 Model Tier、任务枚举、Capability Resolver、隐藏 Adapter、请求调度、缓存边界与两仓库实现契约。
- 国际化 (i18n) 架构与多语言扩展方案： [i18n_architecture.md](./i18n_architecture.md)
  记录 `@md-editor/i18n` 独立包设计、Type-Safe 字典、全应用多语言接入方案及后续新增语言指南。
- 代码库模块化拆分、并发保序保存调度与多端发版架构方案： [codebase_modularization_and_concurrency_architecture.md](./codebase_modularization_and_concurrency_architecture.md)
  记录巨型单体文件拆解与全量注释规范、串行异步保存调度器（防抖/手动并发保护）以及桌面端与 Web 端发版解耦架构。
- uTools 平台插件接入架构方案： [utools_integration_architecture.md](./utools_integration_architecture.md)
  记录 uTools 平台接入定位（临时导流跳板）、apps/utools 完全隔离设计、文件与便签持久化、AI 免责机制与导流规范。

