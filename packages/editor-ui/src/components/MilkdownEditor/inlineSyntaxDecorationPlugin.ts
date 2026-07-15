import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

/**
 * Route D component 2, Step 2: decoration-based styling for the four inline
 * syntaxes that are now plain text (Step 1 removed their PM marks). This plugin
 * scans each textblock's joined inline text with commonmark-aligned regexes and
 * emits two decoration classes per legal pair: `.md-marker-dim` on the marker
 * characters, and `.md-strong`/`.md-em`/`.md-del`/`.md-code` on the inner
 * content. Deleting one marker character makes the regex fail → decoration
 * disappears (spec #7).
 */
export const inlineSyntaxDecorationPluginKey = new PluginKey<DecorationSet>(
  "md-editor-inline-syntax-decoration",
);

// Meta flag used to force a full recompute after IME composition settles.
const REFRESH_META = "refresh-inline-syntax-decoration";

// Object-replacement character ProseMirror uses for non-text inline leaves
// (images, hardbreaks, ...). A match spanning it is not a real inline pair.
const INLINE_LEAF_PLACEHOLDER = "￼";

type SyntaxKind = "code" | "strong" | "del" | "em";

interface SyntaxRule {
  readonly kind: SyntaxKind;
  readonly regex: RegExp;
  readonly markerLength: number;
  readonly contentClass: string;
}

// Priority order matters: code first (its interior is literal, never re-scanned),
// then strong (`**`) before em (`*`) so `**x**` is claimed by strong, then del.
// Each regex is global + multiline and anchored to avoid crossing newlines.
// Content group is lazy and forbids the marker char and newlines to stay
// commonmark-close (mirrors preset strongInputRule `[^*_]+?` / emphasis `[^*]+`).
const SYNTAX_RULES: readonly SyntaxRule[] = [
  {
    kind: "code",
    // `` `code` `` — single backtick pair, no backtick inside, no newline.
    regex: /`([^`\n]+?)`/g,
    markerLength: 1,
    contentClass: "md-code",
  },
  {
    kind: "strong",
    // `**bold**` — two stars each side, inner has no star/newline, not empty.
    regex: /\*\*([^*\n]+?)\*\*/g,
    markerLength: 2,
    contentClass: "md-strong",
  },
  {
    kind: "del",
    // `~~del~~` — two tildes each side.
    regex: /~~([^~\n]+?)~~/g,
    markerLength: 2,
    contentClass: "md-del",
  },
  {
    kind: "em",
    // `*italic*` — single star pair; inner has no star/newline; boundaries
    // reject whitespace right inside the markers (commonmark flanking) so
    // `a * b * c` is not italicised.
    regex: /\*(?![\s*])([^*\n]*[^\s*])\*/g,
    markerLength: 1,
    contentClass: "md-em",
  },
];

interface DecorationSpan {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

interface MatchClaim {
  readonly start: number;
  readonly end: number;
}

/**
 * Scans one textblock's joined inline text and returns absolute-position
 * decoration spans. `blockStart` is the document position of the block's first
 * inline character (i.e. blockNodePos + 1). Exported for unit testing.
 */
export function collectBlockDecorationSpans(text: string, blockStart: number): DecorationSpan[] {
  const spans: DecorationSpan[] = [];
  // Track claimed [start,end) index ranges so higher-priority syntaxes win and
  // overlapping lower-priority matches are skipped (e.g. em inside strong).
  const claimed: MatchClaim[] = [];

  const overlaps = (start: number, end: number): boolean =>
    claimed.some((claim) => start < claim.end && claim.start < end);

  for (const rule of SYNTAX_RULES) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Guard against zero-width loops.
      if (rule.regex.lastIndex === match.index) {
        rule.regex.lastIndex += 1;
      }
      // A match crossing an inline leaf placeholder is not a real text pair.
      if (match[0].includes(INLINE_LEAF_PLACEHOLDER)) {
        continue;
      }
      if (overlaps(start, end)) {
        continue;
      }
      claimed.push({ start, end });

      const contentStart = start + rule.markerLength;
      const contentEnd = end - rule.markerLength;
      // Opening marker.
      spans.push({
        from: blockStart + start,
        to: blockStart + contentStart,
        className: "md-marker-dim",
      });
      // Inner content.
      spans.push({
        from: blockStart + contentStart,
        to: blockStart + contentEnd,
        className: rule.contentClass,
      });
      // Closing marker.
      spans.push({
        from: blockStart + contentEnd,
        to: blockStart + end,
        className: "md-marker-dim",
      });
    }
  }

  return spans;
}

/**
 * Walks the document, joins each textblock's inline text (non-text inline nodes
 * become the placeholder), and builds a DecorationSet from all spans.
 */
export function buildInlineSyntaxDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    // Join inline content: text kept verbatim, leaf inline nodes → placeholder.
    // Newlines between block-child boundaries never occur inside a single
    // textblock, so "\n" as the block separator is unused here; the leaf char
    // preserves offsets so absolute positions map back exactly.
    const text = node.textBetween(0, node.content.size, "\n", INLINE_LEAF_PLACEHOLDER);
    if (text) {
      const blockStart = pos + 1;
      for (const span of collectBlockDecorationSpans(text, blockStart)) {
        if (span.to > span.from) {
          decorations.push(Decoration.inline(span.from, span.to, { class: span.className }));
        }
      }
    }
    // Textblocks do not nest other textblocks; skip descending into inline.
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

export const inlineSyntaxDecorationPlugin = $prose(() => {
  let isComposing = false;

  return new Plugin<DecorationSet>({
    key: inlineSyntaxDecorationPluginKey,
    state: {
      init: (_config, state) => buildInlineSyntaxDecorations(state.doc),
      apply(transaction, previous, _oldState, newState) {
        const forceRefresh = transaction.getMeta(inlineSyntaxDecorationPluginKey) === REFRESH_META;
        if (!transaction.docChanged && !forceRefresh) {
          return previous;
        }
        // During IME composition, ProseMirror suppresses view redraws; recomputing
        // decorations mid-composition can cause flicker. Map the previous set
        // forward instead and recompute once composition settles.
        if (isComposing && !forceRefresh) {
          return previous.map(transaction.mapping, transaction.doc);
        }
        return buildInlineSyntaxDecorations(newState.doc);
      },
    },
    props: {
      decorations: (state) =>
        inlineSyntaxDecorationPluginKey.getState(state) ?? DecorationSet.empty,
      handleDOMEvents: {
        compositionstart() {
          isComposing = true;
          return false;
        },
        compositionend(view) {
          isComposing = false;
          // Force a recompute now that the committed IME text is in the doc.
          view.dispatch(
            view.state.tr
              .setMeta("addToHistory", false)
              .setMeta(inlineSyntaxDecorationPluginKey, REFRESH_META),
          );
          return false;
        },
      },
    },
    view: () => ({
      destroy() {
        isComposing = false;
      },
    }),
  });
});

export type { DecorationSpan, EditorView };
