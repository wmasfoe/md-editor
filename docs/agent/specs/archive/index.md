# 历史规范归档目录 (Archive)

用途：收录在全面迁移至 CodeMirror 6 单编辑器架构之前、属于早期 Milkdown / ProseMirror 架构的废弃规范文档。仅用于追溯历史问题背景，不再作为当前代码实现的行为契约。

## 归档文档清单

- **Milkdown 中文输入法 composition 行高稳定性规范**： [wysiwyg_chinese_ime_composition_layout_spec.md](./wysiwyg_chinese_ime_composition_layout_spec.md)
  - 归档原因：基于 Milkdown / ProseMirror 独有的 `img.ProseMirror-separator` 与 `br.ProseMirror-trailingBreak` DOM 机制。当前已全量迁移至 CodeMirror 6，相关 DOM 结构与修复类名（如 `MilkdownEditor.css`）已全部废弃。
- **Milkdown AI 编辑建议 replacement preview 规范**： [ai_edit_replacement_preview_spec.md](./ai_edit_replacement_preview_spec.md)
  - 归档原因：基于 ProseMirror doc 事务和早期 Milkdown 浮层镜像模型。当前 AI suggestion 与编辑器能力正在重构并收敛至 `@md-editor/editor-core` 与 CodeMirror 6 投影层。

## 注意事项

- 本目录下的所有规范均已失效，请勿在当前的 CodeMirror 6 代码库中引入或遵循本目录中的 ProseMirror/Milkdown 专有逻辑。
