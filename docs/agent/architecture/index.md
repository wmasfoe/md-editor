# 架构文档目录

用途：记录当前 Rust workspace 中的稳定模块边界和已采纳的桌面编辑器架构。对旧 JavaScript / WebView 实现的记录不代表 Beta 当前代码。

## 当前架构

- [GPUI Beta 架构](./gpui_beta_architecture.md)：原生桌面画布、输入/排版分工、源码映射和本地开发命令。
- [GPUI 原生编辑器 ADR](./adr_gpui_native_editor.md)：从 WebView 桌面编辑器迁移至 GPUI 的决策背景。
- [能力边界设计原则](./capability_boundary_design_principles.md)：稳定能力归属核心领域，宿主负责平台接入。
- [Rust workspace 结构](./repo_structure_and_naming_conventions.md)：Beta 应用、crate 与测试的目录职责。
- [macOS 窗口 Chrome 规范](./macos_window_chrome_guidelines.md)：桌面窗口视觉与交互原则。
- [本地模型接入方案](./local_ai_model_integration_plan.md)：端侧 llama.cpp 集成背景与约束；实现状态以 Rust 代码为准。
- [本地 AI 任务适配架构](./local_ai_task_adapter_architecture.md)：本地 AI 任务和模型档位的设计记录。
- [SLM 紧凑协议](./slm_compact_protocol_and_client_integration.md)：本地小模型客户端协议设计记录。
- [AI 写作 Harness 架构](./ai_writing_harness_architecture.md)：AI 编排设计记录，尚未全部迁移到 Beta。

## 历史方案

旧版 Web、插件、移动端、npm 子包、MDX 组件和 JavaScript 编译器的架构文档已从当前导航中移除。它们描述的是历史实现或未采纳方案，不构成 Beta 的构建、运行或扩展契约。仍需追溯时可在 Git 历史中查阅。
