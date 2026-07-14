import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { $remark } from "@milkdown/kit/utils";
import {
  // schema (nodes + marks). Keep every node/mark EXCEPT emphasis/strong/inlineCode.
  docSchema,
  paragraphAttr,
  paragraphSchema,
  headingIdGenerator,
  headingAttr,
  headingSchema,
  hardbreakAttr,
  hardbreakSchema,
  blockquoteAttr,
  blockquoteSchema,
  codeBlockAttr,
  codeBlockSchema,
  hrAttr,
  hrSchema,
  imageAttr,
  imageSchema,
  bulletListAttr,
  bulletListSchema,
  orderedListAttr,
  orderedListSchema,
  listItemAttr,
  listItemSchema,
  linkAttr,
  linkSchema,
  htmlAttr,
  htmlSchema,
  textSchema,
  // input rules (block-level only; the 4 mark input rules are dropped).
  wrapInBlockquoteInputRule,
  wrapInBulletListInputRule,
  wrapInOrderedListInputRule,
  createCodeBlockInputRule,
  insertHrInputRule,
  wrapInHeadingInputRule,
  insertImageInputRule,
  // commands (keep all except the 3 inline-mark toggles).
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
  downgradeHeadingCommand,
  createCodeBlockCommand,
  insertHardbreakCommand,
  insertHrCommand,
  insertImageCommand,
  updateImageCommand,
  wrapInOrderedListCommand,
  wrapInBulletListCommand,
  sinkListItemCommand,
  splitListItemCommand,
  liftListItemCommand,
  liftFirstListItemCommand,
  toggleLinkCommand,
  updateLinkCommand,
  isMarkSelectedCommand,
  isNodeSelectedCommand,
  clearTextInCurrentBlockCommand,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
  addBlockTypeCommand,
  selectTextNearPosCommand,
  // keymap (keep all except emphasis/inlineCode/strong keymaps).
  blockquoteKeymap,
  codeBlockKeymap,
  hardbreakKeymap,
  headingKeymap,
  listItemKeymap,
  orderedListKeymap,
  bulletListKeymap,
  paragraphKeymap,
  // plugins (keep all; remarkMarker only touches strong/emphasis nodes which no
  // longer exist after disable, so it is a harmless no-op).
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  remarkPreserveEmptyLinePlugin,
  syncHeadingIdPlugin,
  syncListOrderPlugin,
} from "@milkdown/kit/preset/commonmark";
import {
  // gfm schema (keep table/tasklist/footnote; drop strikethrough).
  extendListItemSchemaForTask,
  tableSchema,
  tableHeaderRowSchema,
  tableRowSchema,
  tableHeaderSchema,
  tableCellSchema,
  footnoteDefinitionSchema,
  footnoteReferenceSchema,
  // gfm input/paste rules (keep table + tasklist; drop strikethroughInputRule).
  insertTableInputRule,
  wrapInTaskListInputRule,
  tablePasteRule,
  // gfm keymap (keep table; drop strikethroughKeymap).
  tableKeymap,
  // gfm commands (keep table; drop toggleStrikethroughCommand).
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  exitTable,
  insertTableCommand,
  moveRowCommand,
  moveColCommand,
  selectRowCommand,
  selectColCommand,
  selectTableCommand,
  deleteSelectedCellsCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  setAlignCommand,
  // gfm plugins (keep all; remarkGFMPlugin's strikethrough tokenizer is disabled
  // by construct name via the remark disable plugin below).
  keepTableAlignPlugin,
  autoInsertSpanPlugin,
  remarkGFMPlugin,
  tableEditingPlugin,
} from "@milkdown/kit/preset/gfm";

/**
 * micromark construct names for the four inline syntaxes route D turns back into
 * plain text. `attention` covers both `*`/`_` (strong + emphasis), `codeText`
 * covers `` ` `` (inline code), `strikethrough` covers `~~` (gfm delete).
 * Disabling by construct name is global and order-independent (verified in the
 * Step 0 spike against micromark@4 create-tokenizer.js:415).
 */
export const DISABLED_MICROMARK_CONSTRUCTS = [
  "attention",
  "codeText",
  "strikethrough",
] as const;

/**
 * Characters whose unsafe-table escaping we suppress during serialization so the
 * literal markers round-trip identically (`**b**` not `\*\*b\*\*`). Structural
 * characters (`#`, `>`, `[`, `.`, backslash, ...) keep their normal escaping
 * because we only strip these four from `state.unsafe`.
 */
const RAW_EMIT_CHARACTERS = new Set(["*", "_", "`", "~"]);

/**
 * The mark schema names that route D removes from the editor. Exposed for the
 * schema key-set guardrail test.
 */
export const REMOVED_MARK_NAMES = [
  "emphasis",
  "strong",
  "inlineCode",
  "strike_through",
] as const;

/**
 * Custom remark-stringify `text` handler. It temporarily removes the unsafe
 * entries for `* _ \` ~` (both `phrasing` and `atBreak` variants) before calling
 * `state.safe()`, then restores the original list. Result: literal inline
 * markers are emitted raw while every other character keeps its normal
 * escaping. `state.unsafe` is a fresh per-call copy in mdast-util-to-markdown
 * (`unsafe: [...unsafe]`), so mutating and restoring it here is local and safe.
 */
type ToMarkdownState = {
  unsafe: { character?: string }[];
  safe: (value: string, config: unknown) => string;
};
type ToMarkdownTextNode = { value?: string | null };

export function createRawInlineMarkerTextHandler() {
  return function text(
    node: ToMarkdownTextNode,
    _parent: unknown,
    state: ToMarkdownState,
    info: unknown,
  ): string {
    const original = state.unsafe;
    state.unsafe = original.filter(
      (pattern) => !(pattern.character && RAW_EMIT_CHARACTERS.has(pattern.character)),
    );
    try {
      return state.safe(node.value ?? "", info);
    } finally {
      state.unsafe = original;
    }
  };
}

/**
 * Config-stage installer for the raw-emit text handler. Merges (does not
 * replace) the existing stringify handlers so all other node handlers stay
 * intact. Call inside `Editor.make().config((ctx) => ...)`.
 */
export function configureInlineMarkerSerializer(ctx: Ctx): void {
  const options = ctx.get(remarkStringifyOptionsCtx);
  ctx.set(remarkStringifyOptionsCtx, {
    ...options,
    handlers: {
      ...(options.handlers ?? {}),
      text: createRawInlineMarkerTextHandler(),
    },
  });
}

/**
 * remark plugin that disables the four inline-mark micromark constructs at
 * tokenization time, so `**b**`/`*i*`/`` `c` ``/`~~s~~` parse as literal text
 * (no strong/emphasis/inlineCode/delete mdast nodes are produced).
 */
export const disableInlineMarkTokenizationPlugin = $remark(
  "mdEditorDisableInlineMarkTokenization",
  () =>
    function disableInlineMarkTokenization(this: {
      data: () => { micromarkExtensions?: unknown[] };
    }) {
      const data = this.data();
      const micromarkExtensions =
        data.micromarkExtensions ?? (data.micromarkExtensions = []);
      micromarkExtensions.push({
        disable: { null: [...DISABLED_MICROMARK_CONSTRUCTS] },
      });
    },
);

/**
 * Recomposed commonmark keep-list: the full commonmark preset minus the four
 * pieces (schema + input rule + command + keymap) of emphasis / strong /
 * inlineCode. Mirrors preset-commonmark's flat-array ordering.
 *
 * NOTE: left un-flattened on purpose. Schema entries (`$markSchema`/
 * `$nodeSchema`) and keymaps are themselves 2-element arrays whose composite
 * carries `.key.name`; flattening would drop that metadata and break the
 * schema-name guardrail. Milkdown's `.use()` double-flattens, so nesting is
 * fine at registration time.
 */
export const commonmarkKeepList: MilkdownPlugin[] = [
  // schema
  docSchema,
  paragraphAttr,
  paragraphSchema,
  headingIdGenerator,
  headingAttr,
  headingSchema,
  hardbreakAttr,
  hardbreakSchema,
  blockquoteAttr,
  blockquoteSchema,
  codeBlockAttr,
  codeBlockSchema,
  hrAttr,
  hrSchema,
  imageAttr,
  imageSchema,
  bulletListAttr,
  bulletListSchema,
  orderedListAttr,
  orderedListSchema,
  listItemAttr,
  listItemSchema,
  linkAttr,
  linkSchema,
  htmlAttr,
  htmlSchema,
  textSchema,
  // input rules (block only)
  wrapInBlockquoteInputRule,
  wrapInBulletListInputRule,
  wrapInOrderedListInputRule,
  createCodeBlockInputRule,
  insertHrInputRule,
  wrapInHeadingInputRule,
  insertImageInputRule,
  // commands (no emphasis/inlineCode/strong toggles)
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInHeadingCommand,
  downgradeHeadingCommand,
  createCodeBlockCommand,
  insertHardbreakCommand,
  insertHrCommand,
  insertImageCommand,
  updateImageCommand,
  wrapInOrderedListCommand,
  wrapInBulletListCommand,
  sinkListItemCommand,
  splitListItemCommand,
  liftListItemCommand,
  liftFirstListItemCommand,
  toggleLinkCommand,
  updateLinkCommand,
  isMarkSelectedCommand,
  isNodeSelectedCommand,
  clearTextInCurrentBlockCommand,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
  addBlockTypeCommand,
  selectTextNearPosCommand,
  // keymap (no emphasis/inlineCode/strong)
  blockquoteKeymap,
  codeBlockKeymap,
  hardbreakKeymap,
  headingKeymap,
  listItemKeymap,
  orderedListKeymap,
  bulletListKeymap,
  paragraphKeymap,
  // plugins
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  inlineNodesCursorPlugin,
  remarkAddOrderInListPlugin,
  remarkInlineLinkPlugin,
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkMarker,
  remarkPreserveEmptyLinePlugin,
  syncHeadingIdPlugin,
  syncListOrderPlugin,
];

/**
 * Recomposed gfm keep-list: the full gfm preset minus strikethrough's four
 * pieces. Mirrors preset-gfm's flat-array ordering. Left un-flattened (see
 * commonmarkKeepList note).
 */
export const gfmKeepList: MilkdownPlugin[] = [
  // schema (no strikethroughAttr/strikethroughSchema)
  extendListItemSchemaForTask,
  tableSchema,
  tableHeaderRowSchema,
  tableRowSchema,
  tableHeaderSchema,
  tableCellSchema,
  footnoteDefinitionSchema,
  footnoteReferenceSchema,
  // input rules (no strikethroughInputRule)
  insertTableInputRule,
  wrapInTaskListInputRule,
  // paste rules
  tablePasteRule,
  // keymap (no strikethroughKeymap)
  tableKeymap,
  // commands (no toggleStrikethroughCommand)
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  exitTable,
  insertTableCommand,
  moveRowCommand,
  moveColCommand,
  selectRowCommand,
  selectColCommand,
  selectTableCommand,
  deleteSelectedCellsCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  setAlignCommand,
  // plugins
  keepTableAlignPlugin,
  autoInsertSpanPlugin,
  remarkGFMPlugin,
  tableEditingPlugin,
];

/**
 * The full route-D inline-marker plugin bundle: recomposed commonmark + gfm
 * keep-lists plus the tokenization-disable remark plugin. Register in place of
 * `.use(commonmark).use(gfm)`. The serializer text handler is installed
 * separately via `configureInlineMarkerSerializer` in the editor `.config()`.
 *
 * Left nested; Milkdown `.use()` double-flattens at registration.
 */
export const inlineMarkerPreset: MilkdownPlugin[] = [
  ...commonmarkKeepList,
  ...gfmKeepList,
  disableInlineMarkTokenizationPlugin,
];

type SchemaLikePlugin = {
  mark?: unknown;
  node?: unknown;
  key?: { name?: string };
};

/**
 * Extracts mark schema names from a keep-list. Used by the guardrail test to
 * lock the recomposed schema so a Milkdown upgrade that changes bundle
 * composition triggers a diff.
 */
export function collectMarkSchemaNames(list: readonly unknown[]): string[] {
  return collectSchemaNames(list, "mark");
}

/** Extracts node schema names from a keep-list (guardrail test). */
export function collectNodeSchemaNames(list: readonly unknown[]): string[] {
  return collectSchemaNames(list, "node");
}

function collectSchemaNames(list: readonly unknown[], kind: "mark" | "node"): string[] {
  const names = new Set<string>();
  for (const entry of list) {
    const plugin = entry as SchemaLikePlugin;
    if (plugin && kind in plugin && plugin.key?.name) {
      names.add(plugin.key.name);
    }
  }
  return [...names].sort();
}

