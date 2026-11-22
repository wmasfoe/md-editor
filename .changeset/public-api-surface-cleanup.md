---
"@md-editor/editor": minor
"@md-editor/core": minor
"@md-editor/plugin-sdk": minor
"@md-editor/shared": minor
"@md-editor/markdown-fidelity": minor
"@md-editor/plugin-host": patch
---

Consolidate the public API surface ahead of 1.0.

- `@md-editor/editor`: the main entry now exports only the documented API. 71 internal
  pieces moved to the new `@md-editor/editor/internals` subpath (not covered by stability
  promises and listed in the extensibility matrix). `@codemirror/search` re-exports and the
  `getRendererForTesting` helper left the main entry. Typography props were replaced by the
  new `theme` prop (`EditorTheme`), and `--theme-editor-font-size` became a registered
  contract variable consumed by the editor stylesheet. Syntax plugin registration is now
  `plugins` / `ports.setSyntaxPlugins` / `ports.addSyntaxPlugin`; the chainable
  `renderer.use()` and the `syntaxPlugins` alias were removed.
- `@md-editor/core`: command dispatch no longer logs on the success path; `Disposable` is
  re-exported from `@md-editor/shared`.
- `@md-editor/plugin-sdk`: owns `SyntaxPluginRegistry` and its registration invariants;
  declarative and imperative registrations live in separate namespaces so replacing the
  declarative set never drops imperatively registered plugins.
- `@md-editor/shared`: adds the canonical GitHub heading-slug implementation and
  `Disposable`.
- `@md-editor/markdown-fidelity`: heading slugs (outline, anchor resolution) delegate to
  the shared implementation, so non-Latin headings get non-empty stable ids and in-document
  links match exported HTML.
- `@md-editor/editor`: **markdown lint no longer ships with the package.** `enableMarkdownLint`
  now requires a host-injected engine (`markdownlint={{ lint }}` in React, or
  `markdownlint: { lint }` on the bridge) and throws at creation otherwise. `markdownlint`
  moved to an optional peer dependency, so hosts that do not enable lint no longer install it.

### 可选重依赖改为按需加载

`markdownlint`、`sanitize-html`、`mdast-util-*`（含 `micromark-extension-*`）、`turndown` 不再进入首屏静态依赖图。
宿主可感知的四类变化：

- **HTML 块**：消毒器就绪前渲染占位（"Loading HTML preview…"）而不是源码，就绪后自动升级为渲染结果；
- **MDX 块**：解析器就绪前该块保持 `parserCoverage=partial`（显示源码），就绪后自动重解析；
- **粘贴**：转换链就绪前交回浏览器默认粘贴（纯文本），不丢内容；就绪后恢复 HTML→Markdown 转换；
- **Lint**：`markdownlint` 由宿主按需加载（`@md-editor/app-ui/markdownlint` 子入口已改为动态 import），
  引擎就绪前请保持 `enableMarkdownLint` 关闭，就绪后用 `ports.setMarkdownLintEngine` 补注。

新增运行期端口 `ports.setMarkdownLintEngine(engine)`：宿主把 `markdownlint` 改成动态 import 后，引擎通常比视图
晚到；该端口让宿主在引擎就绪时补注，而不必重建视图（重建会丢选区、撤销栈与 IME 状态）。对应 React 侧行为：
`markdownlint` prop 变化就地注入。`enableMarkdownLint` 仍然要求引擎存在，缺失时开启会抛错而不是静默无诊断。

### MDX 组件契约迁移到 `@md-editor/shared/mdx`

`@md-editor/plugin-sdk/mdx` 已移除，其类型（`MdxComponentPlugin` / `MdxComponentDescriptor` / `MdxPropDescriptor` /
`MdxInsertDefinition` / `MdxComponentRegistry` / `MdxPropType`）现由 `@md-editor/shared/mdx` 提供。
原因：`@md-editor/core` 的 `EditorRuntime.mdxComponents` 需要该类型，而 core 必须保持无头——它不能反向依赖 plugin SDK
（否则只装 core 的消费者会连带看到 CodeMirror/Lezer peer）。`@md-editor/core` 的运行时依赖因此收窄为只有
`@md-editor/shared`。迁移方式：把 `from "@md-editor/plugin-sdk/mdx"` 改为 `from "@md-editor/shared/mdx"`。

未就绪判定与就绪重算由 `packages/editor/src/module-loader.ts` 统一提供；渲染器创建时自动预加载，
通常在任何用户交互之前完成。消毒语义未放宽：消毒器未就绪时渲染层只拿占位，不可能装载未消毒内容。

- `@md-editor/plugin-host`: depends on `@md-editor/shared` directly for the MDX component
  contract vocabulary (previously obtained transitively through `@md-editor/plugin-sdk`,
  which no longer re-exports it). No public API change.
