# npm Editor SDK 发布记录

用途：记录 core/editor 及其必需依赖的 npm 版本和消费侧变更。以下版本已于 2026-11-12 发布到 npm。

## core 0.1.0 / editor 0.1.0

- 首次独立分发文档状态、事务、命令和编辑器运行时，以及基于 CodeMirror 6 的 Markdown 源码/所见即所得编辑器。
- editor 提供可选的 `/react` 入口，包含组件样式；基础入口不依赖 React 或应用 UI、应用 i18n、Tauri。
- 分发可直接消费的 ESM JS、TypeScript 声明、CSS 与许可证，不需要 workspace 源码或 TypeScript 运行时加载器。
- 文末 Mermaid 和引用/列表嵌套块复用统一的虚拟行与源码导航契约。
- editor 依赖 plugin-sdk `^0.2.0`；npm 已有的 SDK 0.1.0 不提供其使用的全部接口。

## plugin-sdk 0.2.0

- 新增 `/callout` 纯数据入口，供无 DOM、无 CodeMirror 的调用方直接使用。
- `/syntax` 提供 CJK 语法扩展、`SyntaxPluginHostPorts` 和 `syntaxPluginHostPortsFacet`，由宿主注入交互能力。
- 保留独立的根入口与 `/mdx` 契约；使用 `/syntax` 的宿主需安装该入口的可选 peers。

## 必需依赖首发

- shared 0.1.0：跨包共享的轻量工具。
- markdown-fidelity 0.1.0：Markdown/frontmatter 保真、标题锚点等能力；是 editor 的直接依赖。
- plugin-host 0.1.0：插件注册与加载的宿主能力；是 editor 的直接依赖。

## 导入与运行要求

- callout、CJK 语法工具从 `@md-editor/plugin-sdk/callout` 或 `/syntax` 导入；editor/compiler 不保留原有转发入口。
- editor 是浏览器组件，需 DOM、支持 CSS 的打包器及现代 JavaScript API（包括 `toSorted`）；React 宿主需 React `>=18.3.0 <20`。
- compiler、syntax-plugins 本轮暂缓发布。应用专属 private 包不发布。
