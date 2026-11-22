---
"@md-editor/editor": minor
"@md-editor/plugin-sdk": minor
"@md-editor/shared": minor
"@md-editor/compiler": minor
"@md-editor/markdown-fidelity": minor
---

Fix nine defects reported in the PR #290 post-merge review.

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
