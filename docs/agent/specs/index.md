# 规范文档目录

用途：收录高风险行为规范、棘手回归场景和改动前必须关注的契约。修改相关代码前先读本目录，避免重复踩坑。

## 生效文档 (Active Specs)

- WYSIWYG 选区完整性回归规范： [wysiwyg_selection_integrity_spec.md](./wysiwyg_selection_integrity_spec.md)
- CodeMirror 选区自绘渲染与跨行边界规范： [codemirror_selection_draw_and_overflow_spec.md](./codemirror_selection_draw_and_overflow_spec.md)
- WYSIWYG 表格编辑与生命周期数据同步规范： [wysiwyg_table_editing_and_lifecycle_spec.md](./wysiwyg_table_editing_and_lifecycle_spec.md)
- 跨平台快捷键与修饰键对齐规范： [cross_platform_keyboard_shortcut_spec.md](./cross_platform_keyboard_shortcut_spec.md)
- 编辑器模式切换与 AI 流式生命周期治理规范： [editor_mode_switch_and_ai_lifecycle_spec.md](./editor_mode_switch_and_ai_lifecycle_spec.md)
- 自定义图片相对路径解析与目录拦截规范： [image_path_resolution_and_directory_creation_spec.md](./image_path_resolution_and_directory_creation_spec.md)
- 整行块级替换 Inclusivity 与符号型块间距规范（含 Thematic Break / 表格 / HTML / MDX）： [thematic_break_and_block_inclusivity_spec.md](./thematic_break_and_block_inclusivity_spec.md)
- WYSIWYG 文末虚拟空行规范（光标落点必须是 `doc.length`、块下方只有一个落脚行、物化与撤销、粘贴/IME）： [wysiwyg_virtual_trailing_line_spec.md](./wysiwyg_virtual_trailing_line_spec.md)
- CM6 块级 widget 的文末落脚行规范（构建器何时补空 `.cm-line`、为何复用这一行当落脚点、自己造行的四种做法为何都被否决）： [codemirror_block_widget_trailing_row_spec.md](./codemirror_block_widget_trailing_row_spec.md)
- HTML 块源码展开与预览规范（进入/退出源码、注释块、预览点击、DOMParser 重建、与虚拟行共用文末光标）： [html_block_source_reveal_and_preview_spec.md](./html_block_source_reveal_and_preview_spec.md)
- 编辑器交互测试的区分力规范（回归测试必须在修复被撤销时失败、变异验证做法、七个夹具陷阱）： [editor_interaction_test_discriminating_power_spec.md](./editor_interaction_test_discriminating_power_spec.md)
- CM6 高度图与点击落点保真规范（块间距必须用 padding、禁止 margin）： [codemirror_height_map_and_click_fidelity_spec.md](./codemirror_height_map_and_click_fidelity_spec.md)
- 编辑器模式切换视口滚动与光标几何定位规范： [editor_mode_switch_viewport_and_cursor_spec.md](./editor_mode_switch_viewport_and_cursor_spec.md)
- 编辑器交互契约规范（Tab 归属 / 链接类文本与打开通路 / 图片视频口径，含踩坑与用例缺口）： [editor_interaction_tab_and_links_spec.md](./editor_interaction_tab_and_links_spec.md)
- CJK 友好强调契约规范（`**加粗**` / `~~删除~~` / `==高亮==` 的中文标点邻接、两引擎映射与已知边界）： [cjk_friendly_emphasis_spec.md](./cjk_friendly_emphasis_spec.md)

## 历史归档 (Archive)

- 历史规范归档（早期 Milkdown / ProseMirror 架构废弃规范）： [archive/index.md](./archive/index.md)

## 使用规则

- 涉及 CM6 选区、跨块拖选、atomic range、blockquote、列表、图片、分割线或代码块交互时，先读 WYSIWYG 选区完整性规范。
- 涉及 CodeMirror `drawSelection()` 选区自绘、跨行选区背景左右溢出、`.cm-selectionLayer` 裁剪边界、行高或光标对齐时，先读 CodeMirror 选区自绘渲染与跨行边界规范。
- 涉及富文本表格（GFM Table）DOM 渲染、单元格光标输入、失焦保存或切换模式/保存文档前的数据同步时，先读 WYSIWYG 表格编辑与生命周期数据同步规范。
- 涉及跨平台修饰键文案（Control/Option/Command vs Ctrl/Win/Alt）、macOS 变体字符物理键位兜底匹配、IME 组字隔离或原生菜单加速器时，先读跨平台快捷键与修饰键对齐规范。
- 涉及渲染器模式切换（WYSIWYG <-> Source）、`noop` 幂等性、并发防重入锁或 AI 续写流/幽灵建议清理销毁时，先读编辑器模式切换与 AI 流式生命周期治理规范。
- 涉及图片粘贴保存、`./` 或 `../` 相对路径解析、`${filename}` 变量动态替换或未存在目录拦截创建弹窗时，先读自定义图片相对路径解析与目录拦截规范。
- CM6 整行块级替换（Thematic Break / 表格 / HTML 块 / MDX 块 / setext 等兜底原子块）的 Inclusivity 语义、幽灵空行、块间空行保真或符号型块默认间距时，先读整行块级替换 Inclusivity 与符号型块间距规范。
- 涉及文档末尾是表格 / HTML 块 / 分割线 / MDX 时的光标落点、文末虚拟空行（`virtual-trailing-line.ts`）或改动 `virtualTrailingLineActiveField` 时，先读文末虚拟空行规范。
- 涉及在文档末尾（`doc.length`）放置块级 widget、排查文末块下方多一行/少一行、或升级 `@codemirror/view` 时，先读 CM6 块级 widget 的文末落脚行规范。
- 涉及 HTML 块的源码展开与折叠（`html-projection.ts`）、HTML 预览挂载与点击（`html-block-widget.ts`）、注释块，或 HTML 块贴文末时与虚拟行的光标归属时，先读 HTML 块源码展开与预览规范。
- 新增或修改断言光标位置、按键接管、`.cm-content` 行结构的测试，或为某个修复补回归测试时，先读编辑器交互测试的区分力规范。
- 涉及**给块级行/块级 widget 提供垂直间距**、改块级 `height` / `box-sizing` / `padding` / 行高、新增整行块级 widget，
  或排查「滚动后点击位置与光标落点不一致 / 光标落到隔壁行」时，先读 CM6 高度图与点击落点保真规范。
- 涉及双模式（WYSIWYG <-> Source）切换时视口滚动跳动、长文档光标居中保持或往返无损记忆时，先读编辑器模式切换视口滚动与光标几何定位规范。
- 涉及 Tab 行为（缩进/焦点归属/块级区 fail-closed）、链接类文本（裸 URL / 尖括号 / 行内 / 引用式）的渲染与
  "Cmd/Ctrl+点击用系统浏览器打开"链路、或图片视频的本地 vs 云端口径时，先读编辑器交互契约规范。
- 涉及强调/斜体/删除线/高亮的定界符解析（`**` / `*` / `~~` / `==`）、中文标点邻接不生效、lezer Markdown 扩展链或
  `@md-editor/compiler` 的 marked 配置时，先读 CJK 友好强调契约规范。
- 涉及早期 Milkdown / ProseMirror 历史问题排查时，可按需进入 [archive/index.md](./archive/index.md) 查阅归档规范。
- 新增棘手问题时，优先放在本目录，并在本文件写清楚触发阅读的改动范围。



