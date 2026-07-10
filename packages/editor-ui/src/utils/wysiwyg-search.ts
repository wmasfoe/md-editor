import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

interface SearchMatch {
  readonly from: number;
  readonly to: number;
}

interface SearchRequest {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly activeIndex: number;
}

interface SearchPluginState extends SearchRequest {
  readonly decorations: DecorationSet;
}

export interface SearchResult {
  readonly matchCount: number;
  readonly activeIndex: number;
}

type FrameScheduler = (callback: () => void) => void;

const searchPluginKey = new PluginKey<SearchPluginState>("md-editor-wysiwyg-search");

export const wysiwygSearchPlugin = $prose(
  () =>
    new Plugin<SearchPluginState>({
      key: searchPluginKey,
      state: {
        init: (_, state) => createSearchState(state.doc, "", false, -1),
        apply(transaction, previous) {
          const request = transaction.getMeta(searchPluginKey) as SearchRequest | undefined;
          if (!request && !transaction.docChanged) {
            return previous;
          }

          return createSearchState(
            transaction.doc,
            request?.query ?? previous.query,
            request?.caseSensitive ?? previous.caseSensitive,
            request?.activeIndex ?? previous.activeIndex,
          );
        },
      },
      props: {
        decorations: (state) => searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
      },
    }),
);

export function updateWysiwygSearch(
  view: EditorView,
  query: string,
  caseSensitive: boolean,
  requestedIndex: number,
): SearchResult {
  const matches = findDocumentMatches(view.state.doc, query, caseSensitive);
  const activeIndex = normalizeMatchIndex(requestedIndex, matches.length);
  let transaction = view.state.tr.setMeta(searchPluginKey, {
    query,
    caseSensitive,
    activeIndex,
  } satisfies SearchRequest);

  const activeMatch = matches[activeIndex];
  if (activeMatch) {
    transaction = transaction
      .setSelection(TextSelection.create(transaction.doc, activeMatch.from, activeMatch.to))
      .scrollIntoView();
  }
  view.dispatch(transaction);
  if (activeMatch) {
    revealActiveWysiwygSearchMatch(view.dom);
  }

  return { matchCount: matches.length, activeIndex };
}

export function revealActiveWysiwygSearchMatch(
  root: ParentNode,
  schedule: FrameScheduler = (callback) => window.requestAnimationFrame(callback),
): void {
  // Decorations are written to the DOM during the view update. Waiting for the
  // next frame makes the active marker stable before asking the inner Milkdown
  // scroller to reveal it, without moving focus away from the search field.
  schedule(() => {
    root
      .querySelector<HTMLElement>(".wysiwyg-search-match--active")
      ?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  });
}

export function findTextOccurrences(
  text: string,
  query: string,
  caseSensitive = false,
): readonly { readonly from: number; readonly to: number }[] {
  if (!query) {
    return [];
  }

  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: { from: number; to: number }[] = [];
  let cursor = 0;

  while (cursor <= source.length - needle.length) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }
    matches.push({ from: index, to: index + needle.length });
    cursor = index + needle.length;
  }

  return matches;
}

function createSearchState(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
  requestedIndex: number,
): SearchPluginState {
  const matches = findDocumentMatches(doc, query, caseSensitive);
  const activeIndex = normalizeMatchIndex(requestedIndex, matches.length);
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === activeIndex
            ? "wysiwyg-search-match wysiwyg-search-match--active"
            : "wysiwyg-search-match",
      }),
    ),
  );

  return { query, caseSensitive, activeIndex, decorations };
}

export function findDocumentMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): readonly SearchMatch[] {
  const matches: SearchMatch[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "image") {
      return false;
    }

    if (!node.isText || !node.text) {
      return;
    }

    for (const match of findTextOccurrences(node.text, query, caseSensitive)) {
      matches.push({ from: position + match.from, to: position + match.to });
    }
  });
  return matches;
}

function normalizeMatchIndex(index: number, matchCount: number): number {
  if (matchCount === 0) {
    return -1;
  }
  return ((index % matchCount) + matchCount) % matchCount;
}
