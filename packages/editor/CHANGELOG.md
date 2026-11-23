# @md-editor/editor

## 0.8.1

### Patch Changes

- 6a63324: Ship a task-oriented usage guide with every public package.
  
  Each package gains `USAGE.md` next to its README, and both ship in the tarball, so the npm page
  leads somewhere: minimal setup first, then the recipes people actually need (theme an editor, wire
  images and links, turn on lint, remap shortcuts, build a toolbar, write a plugin, validate a
  package), then a grouped export map so you can find an entry point without reading the source.
  
  The samples are compiled, not typed by hand: the documentation gate now checks `USAGE.md` files
  alongside READMEs, and every marked block is type-checked against the workspace sources. Fifteen
  blocks failed on the first run — `applyEdit({ text })` does not exist, `restoreMarkdownImageSources`
  takes a source map, `plugin-host` has `/github` and `/mdx` subpaths — and were corrected against the
  real signatures.
  
  `KeymapDescriptor.owner`, `resolveKeymaps()`, `ports.setKeymaps()` and the built-in `Mod-/` binding
  are documented here for the first time; the docs describe the current behaviour (an unbound chord
  stays unbound, editor-owned chords need no host listener) rather than the pre-0.8 contract.
- Updated dependencies [6a63324]
  - @md-editor/core@0.7.1
  - @md-editor/plugin-sdk@0.8.2
  - @md-editor/markdown-fidelity@0.3.2
  - @md-editor/shared@0.3.1

## 0.8.0

### Minor Changes

- 4114a68: Bind `Mod-/` inside the editor so hosts no longer implement mode switching themselves.
  
  `createCodeMirrorEditorBridge` now supplies `onToggleSourceMode` to the renderer, and the
  editor's keymap binds `Mod-/` to it. The callback runs the same two-phase switch the port
  exposes (`switchEditorModeSafely`: renderer applies → core commits with CAS → rollback on
  failure), so mounting `<CodeMirrorEditor>` is enough — no `window` listener, no capture-phase
  trick to outrun CodeMirror. Hosts that still bind the chord themselves keep working: their
  `preventDefault` makes CodeMirror skip the event, so nothing runs twice.
  
  `ports.setFormattingKeymaps()` is renamed to `ports.setKeymaps()`. The map is no longer
  only about formatting: `view.toggleSource` is an editor-owned command too, and its chord is
  read from the same table, so remapping mode switching in a host's shortcut settings takes
  effect instead of leaving the built-in binding on the default chord. There is no deprecated
  alias; call sites move to the new name.
  
  Renderer option `onToggleSourceMode` is added for hosts that assemble
  `createCodeMirrorRenderer` directly; without it the chord is not bound at all (the renderer
  has no `DocumentState`, so it cannot switch modes on its own).
  
  Two consequences worth knowing:
  
  - The chord now only fires while the editor has focus. A host that listened on `window` used to
    toggle the mode from the sidebar or a toolbar; inside the editor it is CodeMirror's keymap that
    dispatches, so focus decides. Hosts that want the old reach should keep their own listener — it
    still wins over the built-in one (their `preventDefault` makes CodeMirror skip the event).
  - A failed switch is no longer silent. `CodeMirrorEditorSyncError` gains a `"mode-switch"` variant
    carrying the failed `ModeSwitchResult`, reported through the existing `onSyncError` channel, so a
    host can surface the same toast it used to show. Exhaustive `switch` statements over the union
    need one more case.

### Patch Changes

- Updated dependencies [4114a68]
  - @md-editor/core@0.7.0

## 0.7.0

### Minor Changes

- 48de219: Take formatting defaults from `@md-editor/core` and treat the port table as authoritative.
  
  `createMarkdownFormattingBindings()` used to carry its own copy of every default chord
  (`getKey("format.bold", "Mod-b")`), duplicating `@md-editor/core`'s table. The defaults now come
  from `MARKDOWN_FORMATTING_KEYMAPS`, so there is exactly one place to change them.
  
  The map handed to `setFormattingKeymaps()` is now the **authoritative** table: an id missing from
  it means that command has no chord, and the editor no longer falls back to the default. Hosts are
  expected to pass `resolveKeymaps(createBuiltInKeymaps(), overrides)`, which is what makes
  "unbind" actually unbind — a fixed alias such as `Mod-Shift-k` for `format.codeBlock` disappears
  along with its command instead of lingering after the user removed it.
  
  Callers that previously passed a partial map (only the chords they wanted to change) must merge
  defaults first; passing no map at all still means "all defaults".

### Patch Changes

- cc6bba5: Stop CodeMirror's default keymap from overriding documented editor and host shortcuts.
  
  Three collisions were reproduced in a real browser against a bare `CodeMirrorEditor` mount
  (no host keybindings), and all three silently disagreed with the shortcut tables:
  
  - **`Mod-/` inserted HTML comments instead of leaving the chord alone.** `packages/core`
    declares `Mod-/` as `view.toggleSource`, but `@codemirror/commands` binds the same chord to
    `toggleComment`, and `@codemirror/lang-markdown` supplies block comment tokens, so pressing
    it rewrote the line to `<!-- … -->`. Hosts had to swallow the key in the capture phase to
    make their own binding work — an implementation detail leaking into the contract.
  - **`Mod-Shift-k` deleted the whole line instead of inserting a code block.** The formatting
    keymap binds that chord to `insertCodeBlock` (the documented backup for `Mod-Shift-c`), but
    it was assembled *after* `defaultKeymap`, and the `keymap` facet dispatches in assembly
    order, so upstream `deleteLine` won.
  - **`Mod-i` only worked by luck.** Upstream `selectParentSyntax` claimed the chord; it
    happened to return `false`, and its binding carries `preventDefault: true`, so the event was
    consumed even though nothing happened.
  
  Keymaps now have an explicit ownership policy. Chords that belong to the *host* (mode
  switching, save, open, settings) are dropped from the editor's copy of `defaultKeymap` by a
  new admission layer (`renderer/controller/default-keymap-policy.ts`) instead of being
  swallowed: the editor installs no binding at all, so keydown reaches the host even when the
  host binds in the bubble phase. Chords that belong to the *editor* (bold, italic, links, code
  blocks) are installed with `Prec.high`, which outranks `defaultKeymap` but stays below the
  editor's own `Prec.highest` bindings (the `Tab` arbiter and the HTML source-block keymap) and
  leaves room for a host or plugin to outrank them. The precedence lives inside
  `createMarkdownFormattingKeymap`, so the runtime `setFormattingKeymaps` reconfiguration
  inherits it — otherwise customizing one shortcut would drop back to the default level and
  start deleting lines again.
  
  One **intended** consequence goes beyond the three bugs: the formatting layer now also outranks
  `searchKeymap`, so `Mod-Shift-l` wraps the selection in a link instead of running the search
  package's `selectSelectionMatches`. That matches the shortcut table, which already documents
  `Mod-l`/`Mod-Shift-l` as the link commands. The same holds for `historyKeymap`: a *custom*
  formatting shortcut takes precedence over undo/redo, so remapping a formatting command onto
  `Mod-z` will shadow undo — hosts exposing a shortcut editor should warn about that.
  
  Chord comparison is normalization-aware: upstream writes `Shift-Mod-k` where the formatting
  table writes `Mod-Shift-k`, and both dispatch as the same chord. Chords are split with
  `/-(?!$)/`, matching CodeMirror's own `normalizeKeyName`, so a binding whose main key is `-`
  (`Mod--`) is compared correctly.
- 682dc5c: Fix four behaviours reported after the public-API consolidation.
  
  **MDX content upgrades when the parser arrives late.** A document that opens before the MDX
  parser has loaded records its `<Component>` blocks as plain HTML with
  `parserCoverage === "complete"` — the syntax parsed fine, it simply was not treated as MDX.
  The readiness refresh only looked for incomplete coverage, so it never fired and the blocks
  stayed on the HTML path for the lifetime of the view. The predicate now also recognises
  `<Uppercase` candidates, derived from state rather than a build-time flag (incremental index
  updates reuse historical records, which would drop such a flag on the next keystroke).
  Candidates are found by scanning the document source rather than the record list: on a cold
  start `<Foo ü="test" />` produces **no records at all** — the HTML node rules do not recognise
  tags with non-ASCII attribute names — so a record-based scan missed that whole class of input.
  The scan skips positions that fall inside `deferred-code` / `inline-code` records, and skips
  candidates already covered by an `mdx-jsx` record.
  
  **Failed plugin registration no longer keeps the id.** `registerSyntaxPlugins` and
  `replaceSyntaxPlugins` wrote the registry before building the Lezer language extension and
  dispatching. A plugin that references a parser that does not exist throws
  `Position specified relative to unknown parser` — and that error is **lazy**, raised while the
  view parses the new language, long after the call site that registered it. The caller never
  received a handle, so the desktop host's per-handle rollback could not help: the failed plugin
  kept its id and a corrected retry with the same id failed with `already registered`. Both paths
  now snapshot the registry (including registration tokens, so handles already handed out stay
  valid) and restore it if anything after the write throws.
  
  **Batch plugin registration is atomic across every node declaration.** `registerAll` built its
  conflict set from the decoration-dispatch map only, while single `register` also consults the
  declared-node set. With an existing plugin that declares a node purely through Lezer
  `defineNodes`, a batch of `[valid, conflicting]` passed preflight and then failed partway: the
  valid entry stayed registered after the throw. The batch preflight now reads both maps.
  
  **A plugin cannot silently change registration origin.** `setSyntaxPlugins` compared its
  declarative input against *all* registered plugins, so `addSyntaxPlugin(p)` followed by
  `setSyntaxPlugins([p])` looked unchanged and returned early — `p` stayed in the imperative
  namespace and disappeared once its handle was released. The idempotence guard now compares the
  declarative list only, so the cross-origin case reaches the id-conflict check and throws.
  `SyntaxPluginRegistry.declarativePlugins` backs that guard and is marked `@internal` — it is an
  editor-side implementation detail, not part of the plugin-author contract.
  
  **Nested headings share the document allocator and the alias conflict set.** `convertListItemTokens`
  called `convertBlockTokens([t])` without the document allocator, so a list-item heading got a
  fresh allocator and could duplicate an existing id (`# A` plus `- # A` produced two `id="a"`).
  The export-side alias guard also collected real heading ids from top-level tokens only, so a
  legacy alias could collide with a heading nested in a blockquote or callout. The recursive
  collector walks every array-valued field of a token rather than only `tokens`, because
  containers do not agree on where children live — lists put them in `items[].tokens` while the
  `list` token itself has no `tokens` field, so a `tokens`-only walk missed list-item headings
  entirely (`# テスト手順` plus `- # 手順` still produced duplicate `id="手順"`).
  
  Outline extraction intentionally still lists top-level headings only, but it now allocates ids
  for **every** heading in document order and only then filters to the top level. Without that,
  an earlier nested heading shifts every later top-level id: for `- # A` / `# A` / `# A` the
  export produced `a` / `a-1` / `a-2` while the outline claimed `a` for line 3 and `a-1` for
  line 5, so `#a-1` jumped to the wrong heading and `#a-2` resolved to nothing.
  
  `markdown-fidelity` gets a patch purely for documentation: `extractHeadingOutline` now states
  the "top-level headings only" rule explicitly, alongside the export-side uniqueness contract it
  relies on.
  
  The desktop host also rolls back partial external-plugin registration: if the n-th
  `addSyntaxPlugin` is rejected, the handles already created in that batch are disposed in
  reverse order before the original error is rethrown.
- Updated dependencies [48de219]
- Updated dependencies [682dc5c]
  - @md-editor/core@0.6.0
  - @md-editor/markdown-fidelity@0.3.1
  - @md-editor/plugin-sdk@0.8.1

## 0.6.0

### Minor Changes

- 474f487: Fix nine defects reported in the PR #290 post-merge review.
  
  **Plugin handles only release their own registration.** `SyntaxPluginRegistry` now assigns a
  monotonic token per registration. A handle that already released its registration (or whose
  entry was replaced) no longer removes a later registration of the same plugin object, and
  handles are idempotent. `dispose(id, expected, token)` gained the optional `token` argument;
  `registerImperative(plugin)` returns a handle that carries it. The desktop registrar's
  `dispose` compares the registered instance instead of deleting by id, and `registerAll`
  validates the whole batch before writing, so a rejected batch leaves no partial state.
  
  **`defineNodes` participates in conflict preflight.** Two plugins declaring the same Lezer
  node through `defineNodes` are now rejected, including when only one side uses `nodePolicy`.
  Declared nodes are tracked in a separate table that is not consulted for decoration dispatch,
  because routing them through the dispatch map made `buildDecorations` return an empty array.
  
  **Markdown lint config is committed atomically.** `configureMarkdownLint({ engine, enabled })`
  validates the target combination first and then applies the engine facet and the realtime lint
  extension in a single transaction; `setMarkdownLint` / `setMarkdownLintEngine` delegate to it.
  Previously the React side applied the two in separate effects, so switching from "engine + on"
  to "no engine + off" passed through an invalid "on without engine" state and threw. Enabling
  without an engine still throws, and a rejected combination leaves the previous configuration
  usable. `getMarkdownLintState()` exposes the current `{ enabled, hasEngine }` snapshot.
  
  **Lint types match the official `markdownlint` exports.** `MarkdownLintIssue` now mirrors
  `LintError` nullability (`errorDetail` / `errorContext` are `string | null`, `errorRange` is
  `readonly number[] | null`, `fixInfo` is `MarkdownLintFixInfo | null`), so the documented
  `markdownlint={{ lint }}` compiles in strict mode without a cast. `readConfig` accepts the
  official positional signature. The double `as unknown as` assertion in `@md-editor/app-ui`
  is gone.
  
  ### Breaking type and API changes
  
  These are public-surface changes that may need host-side edits. They ship as a `minor` bump
  under 0.x, but are worth calling out explicitly:
  
  - **`MarkdownLintIssue.severity` narrowed** from `string` to `"error" | "warning"`. A custom
    engine that produces some other value now fails to compile. The official `markdownlint`
    only ever produces these two values, so this matches reality rather than restricting it.
  - **`errorDetail` / `errorContext` / `errorRange` / `fixInfo` are now nullable** to match the
    official `LintError` (`string | null`, `number[] | null`, `FixInfo | null`). Code that reads
    these fields needs a null check — `undefined`-only checks no longer cover every case.
    `errorRange` also widens from a fixed `[number, number]` tuple to `readonly number[]`.
  - **`MarkdownLintResult` is no longer `Readonly`**, and `MarkdownLintRequest.strings` /
    `.config` dropped `Readonly` too. This is what lets the official `lint` be assigned to
    `MarkdownLintEngine` at all (function parameters are contravariant). Treat these values as
    read-only by convention; the type system no longer enforces it.
  - **`noteOptionalModuleDegraded` / `consumeOptionalModuleDegraded` / `degradedScopeCount`
    were removed** from `@md-editor/editor`. They had no remaining consumers inside the repo and
    retained `EditorState` references. `onOptionalModuleReady` now passes the module key.
  - **`parseMdxJsxElements` / `collectMdxElements` / `sanitizeHtmlBlock(D) `lost their optional
    `scope` parameter**, and `MarkdownRangeIndexBuildOptions.degradedScope` is gone. Callers
    passing that argument must drop it.
  - **`extractHeadingOutline` now skips fenced code blocks.** Documents that put `# heading`
    lines inside a fence will see fewer outline entries and different ids for the headings that
    follow — matching what the HTML exporter has always produced.
  
  **Heading anchors are unique per document.** `createHeadingSlugAllocator` records the ids it
  has already assigned and increments until it finds a free one, so `A` / `A` / `A-1` yields
  `a` / `a-1` / `a-1-1` instead of a duplicate `a-1`. Legacy `<a id>` aliases are emitted at most
  once per document, so two headings whose legacy slugs collide no longer produce duplicate ids.
  The outline extractor skips fenced code blocks using the same CommonMark fence rules as the
  exporter, so a `# heading` inside a fence no longer consumes an id that a real heading needs.
  
  **Optional-module readiness refreshes per module.** `onOptionalModuleReady` now reports which
  module became ready. The sanitizer refreshes only the HTML projection, the MDX parser rebuilds
  the parse index, and Turndown dispatches nothing (it only affects the next paste). A throwing
  listener no longer prevents other subscribers from being notified, and no longer looks like an
  import failure. The unused degraded-scope bookkeeping and the `degradedScope` parameters
  threaded through the parse chain were removed; they had no remaining consumers and retained
  `EditorState` references.

### Patch Changes

- Updated dependencies [474f487]
  - @md-editor/plugin-sdk@0.8.0
  - @md-editor/shared@0.3.0
  - @md-editor/markdown-fidelity@0.3.0
  - @md-editor/core@0.5.1

## 0.5.0

### Minor Changes

- f9a6be1: Consolidate the public API surface ahead of 1.0.
  
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
  
  ### 懒加载与 lint 引擎的行为细节
  
  - **多编辑器实例**：可选模块（HTML 消毒 / MDX 解析 / 粘贴转换）就绪后的重算按**视图**隔离。
    此前用模块级标记，页面上有多个编辑器时只有第一个会重算，其余实例的 HTML 块会停在占位、
    MDX 块停在 `parserCoverage=partial`。现在每个实例各自记账。
  - **lint 引擎同一性按函数比较**：`markdownlint={{ lint }}` 这种内联写法每次宿主渲染都是新对象，
    但引擎是否变更按 `lint` / `readConfig` / `applyFixes` 的**函数身份**判断，不会重复 reconfigure
    （也就不会在每次输入时重跑整份 lint）。`CodeMirrorEditor` 的 `markdownlint` prop 因此可在运行中更换，
    就地补注而不重建编辑器。
  - **`enableMarkdownLint` 仍然要求引擎存在**：缺少引擎时开启会**抛错**（不静默无诊断）。
    该错误发生在 `useLayoutEffect` 中，第三方宿主只传 `enableMarkdownLint` 而不传引擎会直接抛出，
    请务必同时提供 `markdownlint`（应用侧可用 `@md-editor/app-ui/markdownlint` 的 `useMarkdownLintEngine`）。
  - **标题锚点去重后缀改为 GitHub 语义**：第 2 个同名标题从 `x-2` 变为 `x-1`。文档里既有的
    `#标题-2` 链接可能指向别的标题或失效 —— 这是用户可见的变化。

### Patch Changes

- Updated dependencies [f9a6be1]
  - @md-editor/core@0.5.0
  - @md-editor/plugin-sdk@0.7.0
  - @md-editor/shared@0.2.0
  - @md-editor/markdown-fidelity@0.2.0

## 0.4.1

### Patch Changes

- a2876e6: Give diagram viewer SVGs an opaque themed surface so the document no longer shows through the diagram, and supply the missing Visimer chrome tokens so diagram menus stay readable in light and dark themes.

## 0.4.0

### Minor Changes

- ffc27d9: Add table range selection, adjustable column widths, and incremental document statistics. Reduce Markdown parsing work during ordinary edits.

### Patch Changes

- ffc27d9: Fix the editor content being shifted right on narrower windows. The content padding floors are now symmetric (`2.5rem` on both sides) instead of `5.5rem` left / `1.25rem` right, so the text column stays centered and no longer hugs the scrollbar; the left floor still covers the fold toggle gutter.
- ffc27d9: Make incremental Markdown index updates linear instead of quadratic. Reused records and rebuilt ranges are now merged in one pass rather than inserted one by one into a sorted array, and coverage is projected from the previous index instead of re-measured. On an 800-block document this drops the per-keystroke cost from ~51ms to ~9ms.
- ffc27d9: Avoid a synchronous full-document parse on every keystroke. `readCoverage` no longer calls `ensureSyntaxTree` on the incremental update path; parse decisions stay in `requiresCompleteParse`, and dirty-range expansion now locates candidates with binary search instead of scanning every record. Also re-measure table overflow when fonts load after mount, not just once via `document.fonts.ready`.
- ffc27d9: Fix tables overflowing the editor with a page-level horizontal scrollbar. Tables now adapt to the content column, wrap long cells, and fall back to scrolling inside the table itself when columns cannot shrink further; row/column handles and column resizing stay usable in both states.

## 0.3.3

### Patch Changes

- a075129: Fix WYSIWYG selection highlighting when a selection starts or ends on a projected frontmatter fence.

## 0.3.2

### Patch Changes

- Updated dependencies [fd6cc1e]
  - @md-editor/core@0.4.0

## 0.3.1

### Patch Changes

- 27a6557: Keep Mermaid insertion within Markdown block boundaries, preserve diagram undo history, and improve source fallback, keyboard access, and localization.
- Updated dependencies [27a6557]
  - @md-editor/plugin-sdk@0.6.0
  - @md-editor/core@0.3.1
  - @md-editor/plugin-host@0.2.2

## 0.3.0

### Minor Changes

- 68ed9ef: Add default-layout Mermaid diagram creation and editing with editor-owned draft sessions and isolated undoable updates.
  
  Keep diagram viewing and editing as the two block actions, with compact contextual tools outside the diagram viewport and single-step connection forms.
  
  Support explicit drag-to-connect tools, geometry-based selection feedback, and cascading deletion of incident edges or messages while preserving surviving entities and styles.
  
  Load the diagram canvas dependency on demand so hosts that never render a diagram no longer pay for it at startup.
  
  Connect flowchart nodes by dragging a handle from the selected node's edges onto a target node, replacing the toolbar connect mode and its source/target form. Double-click a node to edit its label in place, and double-click empty canvas to append a node through the same validated form.

### Patch Changes

- Updated dependencies [68ed9ef]
  - @md-editor/core@0.3.0
  - @md-editor/plugin-sdk@0.5.0
  - @md-editor/plugin-host@0.2.1

## 0.2.3

### Patch Changes

- b231e08: Require @codemirror/view 6.43.15 and @codemirror/state 6.7.6 so multiline block widgets, including an empty setext heading, no longer corrupt the editor tile tree during composition updates. The plugin-sdk peer floors were raised to @codemirror/state ^6.7.6 and @codemirror/view ^6.43.15, so external plugins still on older CodeMirror will get peer warnings.
- Updated dependencies [b231e08]
  - @md-editor/plugin-sdk@0.4.1

## 0.2.2

### Patch Changes

- 52bd6f3: Reveal editable Markdown source when clicking a container directive header.
  Keep callout headers within a single text line so source disclosure does not shift the body.
  Balance callout insets and remove the extra empty line reserved for inactive closing fences.
  Allow GFM alert headers to reveal and edit their original Markdown through pointer and keyboard navigation.
  A callout at the beginning of a document now shows its header source immediately when the initial caret is on that line.

## 0.2.1

### Patch Changes

- Updated dependencies [c4221f5]
  - @md-editor/plugin-sdk@0.4.0
  - @md-editor/plugin-host@0.2.0
  - @md-editor/core@0.2.1

## 0.2.0

### Minor Changes

- 6d9509a: Add a platform-independent document save use case and prepared image insertion with stale-document guards, selection replacement, and atomic undo support.

### Patch Changes

- 6d9509a: Restore the native text caret in editable table cells instead of inheriting the main editor's transparent caret color.
- Updated dependencies [6d9509a]
  - @md-editor/core@0.2.0

## 0.1.1

### Patch Changes

- 2088201: Clarify public package documentation and metadata, and declare the plugin SDK's type dependencies as required peers.
- Updated dependencies [2088201]
  - @md-editor/core@0.1.1
  - @md-editor/markdown-fidelity@0.1.1
  - @md-editor/plugin-host@0.1.1
  - @md-editor/plugin-sdk@0.3.0
  - @md-editor/shared@0.1.1
