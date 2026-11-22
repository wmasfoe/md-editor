---
"@md-editor/editor": patch
"@md-editor/markdown-fidelity": patch
"@md-editor/plugin-sdk": patch
---

Fix four behaviours reported after the public-API consolidation.

**MDX content upgrades when the parser arrives late.** A document that opens before the MDX
parser has loaded records its `<Component>` blocks as plain HTML with
`parserCoverage === "complete"` — the syntax parsed fine, it simply was not treated as MDX.
The readiness refresh only looked for incomplete coverage, so it never fired and the blocks
stayed on the HTML path for the lifetime of the view. The predicate now also recognises
`<Uppercase` candidates still held by an `html` / `deferred-html` record, derived from state
rather than a build-time flag (incremental index updates reuse historical records, which would
drop such a flag on the next keystroke). The match is limited to those two record kinds so a
`<Foo` inside a fenced code block does not trigger a pointless index rebuild.

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

Outline extraction intentionally still lists top-level headings only, and that rule is now
documented and asserted.

`markdown-fidelity` gets a patch purely for documentation: `extractHeadingOutline` now states
the "top-level headings only" rule explicitly, alongside the export-side uniqueness contract it
relies on.

The desktop host also rolls back partial external-plugin registration: if the n-th
`addSyntaxPlugin` is rejected, the handles already created in that batch are disposed in
reverse order before the original error is rethrown.
