# v0.1 Sidebar, Runtime, and Raw Editing Implementation Status

用途：记录本轮实现后 v0.1 桌面编辑器的功能边界，避免继续按 M0 headless 状态判断当前缺口。

## 已实现

- 桌面端支持 `Open Folder...`，原生层递归扫描文件夹，只返回 `.md` / `.mdx` / `.markdown` 文件和包含这些文件的子文件夹。
- 左侧栏提供文件树和大纲两种视图，文件树按目录层级展示，点击 Markdown / MDX 文件后通过原生命令读取内容。
- 大纲目录在左侧展示当前文档的 `h1` 到 `h6`，点击标题会切到源码模式并定位到对应行。
- `Command+Shift+1` 通过 `EditorRuntime` 注册的 keymap 在文件树和大纲间切换。
- macOS 顶部菜单栏提供 `Open Folder...` 和 `Toggle File Tree / Outline`。
- 内置命令和快捷键已由 `FeatureRegistry` / `CommandRegistry` / `KeymapRegistry` 托管，桌面 App 通过 runtime command dispatch 调用文件、视图和侧栏动作。
- 源码模式使用 CodeMirror Markdown extension，保留 fenced code block、Frontmatter、MDX 和 HTML raw block 的源码编辑路径。
- WYSIWYG 使用 Milkdown GFM preset，支持 Markdown 表格等 GFM 语法渲染。源码模式只能由用户显式切换，不能因为 Frontmatter / MDX / HTML raw block 自动切换。

## 仍未完成

- Frontmatter 目前还不是 WYSIWYG metadata block。
- MDX / Callout 目前仍是 headless contract，不是 Milkdown schema / parser / serializer / node view 的真实可视化节点。
- 代码高亮目前主要依赖 CodeMirror 源码模式和 WYSIWYG code block 样式；尚未实现 WYSIWYG fenced code block 的语言级 tokenizer / highlighter。
- 文件树暂不支持折叠状态持久化、右键菜单、新建/重命名/删除文件。
- 大纲暂不支持当前标题高亮、滚动同步和性能优化。

## 后续建议

1. 接入真实 Milkdown / remark-mdx parser adapter，把当前 raw fragment contract 连接到编辑器 schema。
2. 实现 Frontmatter metadata block，只在用户主动编辑时回写 raw YAML。
3. 实现官方 `Callout` node view：卡片化展示 + raw source 编辑。
4. 将文件树操作扩展为完整 workspace lifecycle，包括 recent folder、file operations 和关闭保护。
