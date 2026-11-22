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
