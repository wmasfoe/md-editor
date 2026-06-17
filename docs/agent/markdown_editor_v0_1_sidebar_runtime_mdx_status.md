# v0.1 Sidebar, Runtime, and Raw Editing Implementation Status

用途：记录本轮实现后 v0.1 桌面编辑器的功能边界，避免继续按 M0 headless 状态判断当前缺口。

## 已实现

- 桌面端支持 `Open Folder...`，原生层递归扫描文件夹，只返回 `.md` / `.mdx` / `.markdown` 文件和包含这些文件的子文件夹。
- 左侧栏提供文件树和大纲两种视图，文件树按目录层级展示，点击 Markdown / MDX 文件后通过原生命令读取内容。
- 大纲目录在左侧展示当前文档的 `h1` 到 `h6`，点击标题会在当前编辑模式中定位到对应标题。
- `Command+Shift+1` 通过 `EditorRuntime` 注册的 keymap 在文件树和大纲间切换。
- macOS 顶部菜单栏提供 `Open Folder...` 和 `Toggle File Tree / Outline`。
- 内置命令和快捷键已由 `FeatureRegistry` / `CommandRegistry` / `KeymapRegistry` 托管，桌面 App 通过 runtime command dispatch 调用文件、视图和侧栏动作。
- 源码模式使用 CodeMirror Markdown extension，只能由用户通过菜单或快捷键显式切换进入，内容检测不能改变编辑模式。
- WYSIWYG 使用 Milkdown GFM preset，支持 Markdown 表格和常见内联 HTML 渲染；任何情况下都优先保持所见即所得视图。
- 文件树支持右键菜单、新建 Markdown 文件、新建文件夹、重命名和删除。
- 图片粘贴通过桌面原生命令写入同级 `assets` 目录，再把相对 Markdown 图片语法插入当前文档；粘贴后切回编辑预览模式并刷新当前文件树。
- 文件树会显示常见图片资源，点击图片资源会在编辑区打开图片预览，不切换当前 Markdown 文档。
- 打开单个 Markdown 文件时会把该文件所在目录作为文件树来源，便于查看同级 `assets`。
- 桌面端启用 Tauri `protocol-asset` / `assetProtocol`，WYSIWYG 预览会把本地相对图片路径临时解析成 Tauri asset URL，保存回写时再映射回原始 Markdown 相对路径。
- 窗口关闭和浏览器卸载路径会在 dirty 文档上提示确认。

## 仍未完成

- Frontmatter 目前还不是独立的 Milkdown metadata node view。
- MDX / Callout 目前仍是 headless contract，不是 Milkdown schema / parser / serializer / node view 的真实可视化节点。
- 代码高亮目前主要依赖 CodeMirror 源码模式和 WYSIWYG code block 样式；尚未实现 WYSIWYG fenced code block 的语言级 tokenizer / highlighter。
- 文件树暂不支持折叠状态持久化。
- 大纲暂不支持当前标题高亮、滚动同步和性能优化。

## 后续建议

1. 接入真实 Milkdown / remark-mdx parser adapter，把当前 raw fragment contract 连接到编辑器 schema。
2. 实现 Frontmatter metadata block，只在用户主动编辑时回写 raw YAML。
3. 实现官方 `Callout` node view：卡片化展示 + raw source 编辑。
4. 将文件树操作扩展为完整 workspace lifecycle，包括 recent folder、file operations 和关闭保护。
