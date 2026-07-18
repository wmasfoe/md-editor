# v0.1 Sidebar, Runtime, and Raw Editing Implementation Status

用途：记录本轮实现后 v0.1 桌面编辑器的功能边界，避免继续按 M0 headless 状态判断当前缺口。

> 状态：迁移前实现基线。本文描述的 Milkdown / SourceEditor 能力仍与当前代码相符，但不再代表未来架构；Callout 的现状是正则派生的轻量预览，不是官方 React 组件真实渲染。CM6 实时进度见 [`codemirror_renderer_migration_status.md`](./codemirror_renderer_migration_status.md)。

## 已实现

- 桌面端支持 `Open Folder...`，原生层递归扫描文件夹，只返回 `.md` / `.mdx` / `.markdown` 文件和包含这些文件的子文件夹。
- 左侧栏提供文件树和大纲两种视图，文件树按目录层级展示，点击 Markdown / MDX 文件后通过原生命令读取内容。
- 大纲目录在左侧展示当前文档的 `h1` 到 `h6`，点击标题会在当前编辑模式中定位到对应标题。
- 大纲会跟随源码模式和 WYSIWYG 模式的编辑区滚动高亮当前标题，并保持当前标题项在侧栏可见。
- `Command+Shift+1` 通过 `EditorRuntime` 注册的 keymap 在文件树和大纲间切换。
- macOS 顶部菜单栏提供 `Open Folder...` 和 `Toggle File Tree / Outline`。
- 内置命令和快捷键已由 `FeatureRegistry` / `CommandRegistry` / `KeymapRegistry` 托管，桌面 App 通过 runtime command dispatch 调用文件、视图和侧栏动作。
- 源码模式使用 CodeMirror Markdown extension，只能由用户通过菜单或快捷键显式切换进入，内容检测不能改变编辑模式。
- WYSIWYG 使用 Milkdown GFM preset，支持 Markdown 表格和常见内联 HTML 渲染；任何情况下都优先保持所见即所得视图。
- WYSIWYG fenced code block 使用 ProseMirror decoration 做轻量级基础高亮，覆盖常见 JS/TS/JSON/YAML/Shell/CSS/HTML token，不改写文档内容。
- WYSIWYG code block 支持复制按钮、Tab 缩进，以及右下角语言输入；语言输入提供模糊匹配下拉提示，但最终以用户输入文本写回 fenced code language。
- 文件树支持右键菜单、新建 Markdown 文件、新建文件夹、重命名和删除。
- 文件树按打开的 workspace 持久化目录折叠状态，重新打开同一目录时恢复上次浏览状态。
- 图片粘贴通过桌面原生命令写入同级 `assets` 目录，再把相对 Markdown 图片语法插入当前文档；粘贴后切回编辑预览模式并刷新当前文件树。
- 文件树会显示常见图片资源，点击图片资源会在编辑区打开图片预览，不切换当前 Markdown 文档。
- 打开单个 Markdown 文件时会把该文件所在目录作为文件树来源，便于查看同级 `assets`。
- 桌面端启用 Tauri `protocol-asset` / `assetProtocol`，WYSIWYG 预览会把本地相对图片路径临时解析成 Tauri asset URL，保存回写时再映射回原始 Markdown 相对路径。
- 窗口关闭和浏览器卸载路径会在 dirty 文档上提示确认。
- Frontmatter 在 WYSIWYG 中托管为可编辑 raw metadata block；用户未改动时保持原始 YAML，改动后保存回标准 `---` frontmatter。
- `Callout` 源码由 Milkdown code-block 工具用正则派生轻量预览并隐藏 raw body；未知大写 MDX 组件仍以可编辑 raw MDX block 托管。两者保存时回写真实 MDX 源码，不执行官方 React 组件代码。

## v0.1 后置 / v0.2 缺口

- Frontmatter 目前是 raw metadata block，不是表单化 metadata editor。
- Callout 目前是由 raw source 派生的轻量视觉预览，已有 ProseMirror `NodeSelection`、选中描边和两步整块删除，但不是官方 React 渲染，也不具备 CM6 renderer 的原子交互状态、后代事件拦截或 Widget 生命周期证据；其他 MDX 仍是 raw source block，也不执行完整 MDX runtime。
- 代码块高亮仍是轻量级 token 规则，不是 Shiki / tree-sitter 级完整语言高亮；复杂 selection 保持和更多代码块编辑细节仍可继续增强。
- 大纲长文档性能优化仍可继续增强。

## 本轮完成标记

记录日期：2026-06-18

- 已完成：文件树新建空文件夹后刷新可见，避免创建成功但被空目录过滤隐藏。
- 已完成：文件树折叠状态持久化，按 workspace 记录并恢复目录展开状态。
- 已完成：大纲当前标题高亮和滚动同步，覆盖 Source Mode 与 WYSIWYG 模式。
- 已完成：WYSIWYG fenced code block 轻量级基础高亮。
- 已完成：WYSIWYG code block 复制按钮、Tab 缩进、语言输入与模糊提示。
- 已完成：Frontmatter / 未知 MDX 在 WYSIWYG 中以托管 raw block 展示和编辑；Callout 从 raw source 派生轻量预览；保存均恢复为作者源码。
- 已修复：输入 ``` 生成 fenced code block 时不再把工具条直接插入 ProseMirror 管理的 `pre` DOM，避免编辑器反复同步导致卡死。
- 已验证：`cargo test` 覆盖空目录显示和新建文件夹刷新树。
- 已验证：`node packages/editor-ui/node_modules/typescript/bin/tsc -p packages/editor-ui/tsconfig.json --noEmit`。
- 已验证：`node apps/desktop/node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit`。
- 已验证：`node packages/markdown-fidelity/node_modules/typescript/bin/tsc -p packages/markdown-fidelity/tsconfig.json --noEmit`。
- 已验证：`node node_modules/vitest/vitest.mjs run packages/markdown-fidelity/tests/fidelity.test.ts`。
- 已验证：`node node_modules/vitest/vitest.mjs run packages/editor-ui/src/code-highlight.test.ts`。
- 已验证：`node node_modules/vitest/vitest.mjs run packages/editor-ui/src/code-block-tools.test.ts packages/editor-ui/src/code-highlight.test.ts`。

## 后续方向

1. 不再接入新的 Milkdown / ProseMirror parser、schema 或 NodeView；相关能力迁移到 CM6 renderer。
2. Frontmatter 继续使用可编辑 YAML raw block，不升级为表单编辑。
3. 官方 `Callout` 在 CM6 中真实渲染并作为原子块选择，修改统一进入全局源码模式。
4. 文件树和 workspace lifecycle 属于独立桌面能力，可以继续沿现有边界演进。
