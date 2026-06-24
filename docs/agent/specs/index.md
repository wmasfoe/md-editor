# 规范文档目录

用途：收录高风险行为规范、棘手回归场景和改动前必须关注的契约。修改相关代码前先读本目录，避免重复踩坑。

## 文档

- WYSIWYG 选区完整性回归规范： [wysiwyg_selection_integrity_spec.md](./wysiwyg_selection_integrity_spec.md)

## 使用规则

- 涉及编辑器选区、拖选、ProseMirror NodeView、blockquote、列表或图片节点交互时，先读 WYSIWYG 选区规范。
- 新增棘手问题时，优先放在本目录，并在本文件写清楚触发阅读的改动范围。
