# GPUI 编辑器对齐交接（2026-11-20）

用途：记录 GPUI 原生编辑器与 Tauri 2 (CodeMirror 6) 编辑器对齐进度、工作区快照与全套自动化验证结果。原始差距分析见 [GPUI 与 Tauri 差距](./gpui-tauri-editor-parity.md)。

## 工作区与保护数据

- 分支 `feature/native-editor-parity`。
- `stash@{0}` 是合并 beta 前为旧编辑器改动创建的保护副本，请保持保留。
- 本轮已完整交付主要高频交互与核心能力对齐（查找替换、Hot Exit 会话与草稿恢复、列表/表格智能导航、成对符号包裹、任务清单勾选、标题栏文档统计），并通过全套单测、静态检查和类型检查。

## 当前实现与对齐状态

| 能力 | 实施位置与实现细节 | 对齐状态 |
| --- | --- | --- |
| 垂直导航列记忆 (Goal Column) | [packages/editor-typeset/src/movement.rs](../../../packages/editor-typeset/src/movement.rs) 实现 `move_vertical_with_goal`，在 [packages/editor-gpui/src/typeset_view.rs](../../../packages/editor-gpui/src/typeset_view.rs) 维护连续上下方向键的水平 `goal_x` 坐标，跨越短行和跨段落进入相邻块时始终对齐原列，彻底消除上下方向键跨段跳回行首/行尾的割裂感。 | ✅ 完全对齐 |
| 选区方向键折叠 | 在 `do_move_left` 与 `do_move_right` 实现非折叠选区无 Shift 时按左方向键折叠至选区起点、按右方向键折叠至选区终点；上下方向键根据方向折叠至首尾，完全对齐 CodeMirror/主流桌面编辑器交互标准。 | ✅ 完全对齐 |
| 多行选区 Tab 缩进 | 在 `key_context` 派发 `TypesetView has_selection`，多行选区按 `Tab` 统一缩进 2 空格、`Shift-Tab` 统一反缩进 2 空格；普通单光标文本保留 `\t` 文本输入兼容性。 | ✅ 完全对齐 |
| 空间加权命中与文末留白点击 | 在 [packages/editor-typeset/src/geometry.rs](../../../packages/editor-typeset/src/geometry.rs) 实现 `dy * 1000.0 + dx` 距离加权，消除并排表格单元格与边缘的随机选择；点击正文底端留白区（超过最后渲染块底部）自动定位至文末（`markdown().len()`），避免用户被困在文末表格或代码块中无法续写。 | ✅ 完全对齐 |
| 软折行与行内代码定界符映射 | 在 [packages/editor-typeset/src/lib.rs](../../../packages/editor-typeset/src/lib.rs) `rendered_maps` 放行多行软换行（`\n`）与行内代码（`` `code` ``），彻底修复包含代码段或跨行段落点击光标偏移 1~2 字符的历史遗留缺陷。 | ✅ 完全对齐 |
| 查找与替换 | [packages/editor-core/src/lib.rs](../../../packages/editor-core/src/lib.rs) 实现 `FindOptions`（大小写敏感、全字匹配、正则）、匹配定位与单项/全部替换；[packages/editor-gpui/src/find.rs](../../../packages/editor-gpui/src/find.rs) 实现 Liquid Glass 浮动面板、计数徽章（如 `1/5` 或 `无结果`）、条件切换按钮（`Aa` / `\b` / `.*`）、展开替换栏与“替换”/“全部替换”单步撤销。 | ✅ 完全对齐 |
| Hot Exit 会话与草稿恢复 | [apps/desktop/src/session.rs](../../../apps/desktop/src/session.rs) 实现原子持久化（`HotExitSession`）、退出前光标与草稿写入；[apps/desktop/src/workspace.rs](../../../apps/desktop/src/workspace.rs) 与 [chrome.rs](../../../apps/desktop/src/workspace/chrome.rs) 实现 `DraftRecoveryBanner`（琥珀色提示条、草稿时间、查看预览弹窗、恢复草稿与光标复原、丢弃草稿、启动自动探测）。 | ✅ 完全对齐 |
| 智能链接粘贴 (Smart Link Paste) | 选中文本粘贴合法 URL 自动转换为 `[selected](url)`，保持单步撤销。 | ✅ 完全对齐 |
| 智能退格与闭合括号跳出 | 在空成对符号 `**|**`、`*|*`、`""`、`()`、`[]`、`{}` 间按退格同步删除闭合符号；任务复选框 `- [ ] ` 退格回退为普通项目符号 `- `；光标停在闭合括号前输入对应闭合括号直接跳过。 | ✅ 完全对齐 |
| 表格垂直导航与软换行 | 表格内 Enter 垂直跳至下一行同列单元格或在最后一行自动追加新行（空单元格退出表格）；Shift-Enter 插入 `<br>` 软换行。 | ✅ 完全对齐 |
| 列表智能缩进 | [packages/editor-typeset/src/list_newline.rs](../../../packages/editor-typeset/src/list_newline.rs) 与 [packages/editor-gpui/src/typeset_view.rs](../../../packages/editor-gpui/src/typeset_view.rs) 实现 `Tab` / `Shift-Tab` 针对列表项的缩进（+2空格）与反缩进（-2空格），通过上下文绑定不干扰表格与普通制表符。 | ✅ 完全对齐 |
| 任务清单勾选点击切换 | [packages/editor-typeset/src/list_newline.rs](../../../packages/editor-typeset/src/list_newline.rs) 与 [packages/editor-gpui/src/typeset_view.rs](../../../packages/editor-gpui/src/typeset_view.rs) 实现点击 `- [ ] ` / `- [x] ` 框选区域时原地翻转勾选状态（`toggle_task_checkbox`），保持单步撤销。 | ✅ 完全对齐 |
| 标题栏文档统计信息 | [packages/editor-core/src/lib.rs](../../../packages/editor-core/src/lib.rs) 实现 `calculate_document_metrics`（中英文 CJK + 单词分词统计词数、行数、字符数）；[apps/desktop/src/workspace/chrome.rs](../../../apps/desktop/src/workspace/chrome.rs) 在标题栏右侧实现点击轮转切换指标按钮（词数 / 行数 / 字符数）与居中自适应布局。 | ✅ 完全对齐 |
| 格式快捷键与命令 | 粗体、斜体、行内代码、删除线在 macOS / Windows 快捷键绑定与双向还原开关；标题 1~6（Cmd-1~6）与清空标题（Cmd-0）；引用/无序/有序/任务列表快捷切换。 | ✅ 完全对齐 |
| 字体偏好与正文排版 | 设置面板独立修改中英文及代码字体与排版字号，实时重排正文。 | ✅ 完全对齐 |
| 图片本地存储与粘贴 | 桌面剪贴板图片异步落盘并插入相对引用。 | ✅ 完全对齐 |

## 验证与验收结论

1. **Rust 原生四包测试**：
   - 运行：`cargo test --locked --workspace`
   - 结果：**157 passed; 0 failed; 0 ignored**。
2. **全仓静态与代码风格检查**：
   - 运行：`pnpm lint`
   - 包含：Oxlint (725 文件 0 warnings 0 errors)、Prettier (全量通过)、仓库架构规范检查 (0 errors)、Cargo fmt 与 Clippy (0 warnings)。
3. **全仓单元与集成测试**：
   - 运行：`pnpm test`
   - 结果：所有 package、worker、脚本测试 100% 通过。
4. **全仓 TypeScript 类型检查**：
   - 运行：`pnpm typecheck`
   - 结果：21 个工作空间 package 100% 通过，0 类型错误。
