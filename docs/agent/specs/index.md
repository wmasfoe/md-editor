# 编辑器行为规范目录

用途：收录 Markdown 编辑器用户可见行为要求和历史回归场景。旧文档中的 CodeMirror、DOM、WebView、Tauri 或 JavaScript API 只描述旧实现；迁移到 Rust 后必须按当前代码重新验证，不能直接照搬旧实现细节。

## 仍适用的交互要求

- [CJK 强调标记](./cjk_friendly_emphasis_spec.md)：中文标点邻接时的粗体、删除线和高亮语义。
- [跨平台快捷键](./cross_platform_keyboard_shortcut_spec.md)：快捷键平台映射与修饰键呈现目标；当前键位以 Rust app 绑定为准。
- [系统文件打开](./desktop_system_file_open_spec.md)：通过系统或启动参数打开文档的行为场景；旧版运行时细节已过期。
- [图片路径与目录创建](./image_path_resolution_and_directory_creation_spec.md)：相对路径解析和图片资源行为要求；旧版实现细节已过期。
- [Tab、链接与打开行为](./editor_interaction_tab_and_links_spec.md)：键盘焦点、链接文本和打开目标的用户可见行为。
- [表格编辑生命周期](./wysiwyg_table_editing_and_lifecycle_spec.md)：表格单元格编辑、提交与文档同步的场景；具体机制应由 Rust 编辑器定义。

## 历史实现规范

- CodeMirror 的 DOM、widget、selection、height map、HTML 预览和虚拟行规范不适用于当前 GPUI 实现，已从活动规范列表移除。
- 早期 Milkdown / ProseMirror 记录见[历史归档](./archive/index.md)。

## 使用规则

- 实现或修复 Rust 编辑器时，先从当前 Rust 源码、测试和 GPUI 架构文档建立现状，再把适用的用户可见行为转成 Rust 测试。
- 不得因为旧规范标记“已验证”就声称当前 Rust 行为已验证。
