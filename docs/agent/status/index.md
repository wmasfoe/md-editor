# 状态与历史记录

用途：记录阶段性实施状态和历史技术验证。旧记录中的 branch、工作树、Tauri/Web parity、WASM 或 pnpm 命令都属于当时快照，不是当前 Beta 指引。

## 仍可参考的记录

- [GPUI 编辑器迁移交接记录](./gpui-tauri-editor-parity-handoff.md)：2026-11-20 的 GPUI 编辑器状态快照。其迁移前提和工作树信息已经过期；当前 crate 结构、功能和验证以 Rust 代码与 [GPUI 架构文档](../architecture/gpui_beta_architecture.md)为准。
- [GPUI Beta 交互修复证据](./gpui-beta-interaction-fixes-evidence.md)：审计矩阵各项的修复位置、判别力实测、收尾自查修掉的 11 项缺陷、性能现状与已知限制。方案类内容标注为未实现。
- [本地模型生命周期记录](./local_ai_model_multi_tier_and_lifecycle_status.md)：旧版多档位模型方案的历史记录；当前实现以 `apps/desktop/src/local_ai.rs` 为准。

其他历史迁移和 spike 记录不作为当前代码说明；需要追溯时查看 Git 历史。
