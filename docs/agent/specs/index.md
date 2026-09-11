# 规范文档目录

用途：收录高风险行为规范、棘手回归场景和改动前必须关注的契约。修改相关代码前先读本目录，避免重复踩坑。

## 生效文档 (Active Specs)

- WYSIWYG 选区完整性回归规范： [wysiwyg_selection_integrity_spec.md](./wysiwyg_selection_integrity_spec.md)
- CodeMirror 选区自绘渲染与跨行边界规范： [codemirror_selection_draw_and_overflow_spec.md](./codemirror_selection_draw_and_overflow_spec.md)
- WYSIWYG 表格编辑与生命周期数据同步规范： [wysiwyg_table_editing_and_lifecycle_spec.md](./wysiwyg_table_editing_and_lifecycle_spec.md)
- 跨平台快捷键与修饰键对齐规范： [cross_platform_keyboard_shortcut_spec.md](./cross_platform_keyboard_shortcut_spec.md)
- 编辑器模式切换与 AI 流式生命周期治理规范： [editor_mode_switch_and_ai_lifecycle_spec.md](./editor_mode_switch_and_ai_lifecycle_spec.md)
- 自定义图片相对路径解析与目录拦截规范： [image_path_resolution_and_directory_creation_spec.md](./image_path_resolution_and_directory_creation_spec.md)

## 历史归档 (Archive)

- 历史规范归档（早期 Milkdown / ProseMirror 架构废弃规范）： [archive/index.md](./archive/index.md)

## 使用规则

- 涉及 CM6 选区、跨块拖选、atomic range、blockquote、列表、图片、分割线或代码块交互时，先读 WYSIWYG 选区完整性规范。
- 涉及 CodeMirror `drawSelection()` 选区自绘、跨行选区背景左右溢出、`.cm-selectionLayer` 裁剪边界、行高或光标对齐时，先读 CodeMirror 选区自绘渲染与跨行边界规范。
- 涉及富文本表格（GFM Table）DOM 渲染、单元格光标输入、失焦保存或切换模式/保存文档前的数据同步时，先读 WYSIWYG 表格编辑与生命周期数据同步规范。
- 涉及跨平台修饰键文案（Control/Option/Command vs Ctrl/Win/Alt）、macOS 变体字符物理键位兜底匹配、IME 组字隔离或原生菜单加速器时，先读跨平台快捷键与修饰键对齐规范。
- 涉及渲染器模式切换（WYSIWYG <-> Source）、`noop` 幂等性、并发防重入锁或 AI 续写流/幽灵建议清理销毁时，先读编辑器模式切换与 AI 流式生命周期治理规范。
- 涉及图片粘贴保存、`./` 或 `../` 相对路径解析、`${filename}` 变量动态替换或未存在目录拦截创建弹窗时，先读自定义图片相对路径解析与目录拦截规范。
- 涉及早期 Milkdown / ProseMirror 历史问题排查时，可按需进入 [archive/index.md](./archive/index.md) 查阅归档规范。
- 新增棘手问题时，优先放在本目录，并在本文件写清楚触发阅读的改动范围。
