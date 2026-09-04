# 规范文档目录

用途：收录高风险行为规范、棘手回归场景和改动前必须关注的契约。修改相关代码前先读本目录，避免重复踩坑。

## 生效文档 (Active Specs)

- WYSIWYG 选区完整性回归规范： [wysiwyg_selection_integrity_spec.md](./wysiwyg_selection_integrity_spec.md)
- CodeMirror 选区自绘渲染与跨行边界规范： [codemirror_selection_draw_and_overflow_spec.md](./codemirror_selection_draw_and_overflow_spec.md)

## 历史归档 (Archive)

- 历史规范归档（早期 Milkdown / ProseMirror 架构废弃规范）： [archive/index.md](./archive/index.md)

## 使用规则

- 涉及 CM6 选区、跨块拖选、atomic range、blockquote、列表、图片、分割线或代码块交互时，先读 WYSIWYG 选区完整性规范。
- 涉及 CodeMirror `drawSelection()` 选区自绘、跨行选区背景左右溢出、`.cm-selectionLayer` 裁剪边界、行高或光标对齐时，先读 CodeMirror 选区自绘渲染与跨行边界规范。
- 涉及早期 Milkdown / ProseMirror 历史问题排查时，可按需进入 [archive/index.md](./archive/index.md) 查阅归档规范。
- 新增棘手问题时，优先放在本目录，并在本文件写清楚触发阅读的改动范围。
