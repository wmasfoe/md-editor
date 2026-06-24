import { $prose } from "@milkdown/kit/utils";
import type {
  AiCompletionContext,
  AiWritingEditSuggestion,
  AiWritingSuggestion,
  EditorMode
} from "@md-editor/editor-core";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

interface AiSuggestionState {
  readonly id: number;
  readonly position: number;
  readonly continuation?: string;
  readonly edit?: AnchoredEditSuggestion;
  readonly decorations: DecorationSet;
}

type AiSuggestionMeta =
  | {
      readonly type: "show";
      readonly id: number;
      readonly position: number;
      readonly suggestion: AiWritingSuggestion;
    }
  | {
      readonly type: "clear";
    };

interface AnchoredEditSuggestion extends AiWritingEditSuggestion {
  readonly from: number;
  readonly to: number;
}

const aiSuggestionPluginKey = new PluginKey<AiSuggestionState | null>("md-editor-ai-suggestion");
const BEFORE_CONTEXT_CHARS = 3_000;
const AFTER_CONTEXT_CHARS = 1_500;

export const aiSuggestionPlugin = $prose(
  () =>
    new Plugin<AiSuggestionState | null>({
      key: aiSuggestionPluginKey,
      state: {
        init: () => null,
        apply(transaction, previous) {
          const meta = transaction.getMeta(aiSuggestionPluginKey) as AiSuggestionMeta | undefined;
          if (meta?.type === "clear") {
            return null;
          }
          if (meta?.type === "show") {
            return createAiSuggestionState(transaction.doc, meta.id, meta.position, meta.suggestion);
          }
          if (!previous) {
            return null;
          }
          if (transaction.docChanged || transaction.selectionSet) {
            return null;
          }
          return {
            ...previous,
            decorations: previous.decorations.map(transaction.mapping, transaction.doc)
          };
        }
      },
      props: {
        decorations(state) {
          return aiSuggestionPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
        },
        handleKeyDown(view, event) {
          const state = aiSuggestionPluginKey.getState(view.state);
          if (!state) {
            return false;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            clearAiSuggestion(view);
            return true;
          }

          if (event.key === "Tab" && state.edit) {
            event.preventDefault();
            view.dispatch(
              view.state.tr
                .insertText(state.edit.replacement, state.edit.from, state.edit.to)
                .setMeta(aiSuggestionPluginKey, { type: "clear" } satisfies AiSuggestionMeta)
                .scrollIntoView()
            );
            requestAnimationFrame(() => view.focus());
            return true;
          }

          if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight" && state.continuation) {
            event.preventDefault();
            view.dispatch(
              view.state.tr
                .insertText(state.continuation, state.position, state.position)
                .setMeta(aiSuggestionPluginKey, { type: "clear" } satisfies AiSuggestionMeta)
                .scrollIntoView()
            );
            requestAnimationFrame(() => view.focus());
            return true;
          }

          return false;
        }
      }
    })
);

export function showAiSuggestion(view: EditorView, id: number, suggestion: AiWritingSuggestion): void {
  const normalizedSuggestion = normalizeSuggestion(view, suggestion);
  if (!normalizedSuggestion.continuation && !normalizedSuggestion.edit) {
    clearAiSuggestion(view);
    return;
  }

  view.dispatch(
    view.state.tr.setMeta(aiSuggestionPluginKey, {
      type: "show",
      id,
      position: view.state.selection.to,
      suggestion: normalizedSuggestion
    } satisfies AiSuggestionMeta)
  );
}

export function clearAiSuggestion(view: EditorView): void {
  if (!aiSuggestionPluginKey.getState(view.state)) {
    return;
  }

  view.dispatch(view.state.tr.setMeta(aiSuggestionPluginKey, { type: "clear" } satisfies AiSuggestionMeta));
}

export function getAiCompletionContext(view: EditorView, mode: EditorMode): AiCompletionContext {
  const selection = view.state.selection;
  const doc = view.state.doc;
  return {
    before: doc.textBetween(0, selection.from, "\n\n", "\n").slice(-BEFORE_CONTEXT_CHARS),
    after: doc.textBetween(selection.to, doc.content.size, "\n\n", "\n").slice(0, AFTER_CONTEXT_CHARS),
    selectedText: selection.empty ? "" : doc.textBetween(selection.from, selection.to, "\n\n", "\n"),
    mode
  };
}

function createAiSuggestionState(
  doc: ProseMirrorNode,
  id: number,
  position: number,
  suggestion: AiWritingSuggestion
): AiSuggestionState {
  const safePosition = Math.max(0, Math.min(position, doc.content.size));
  const decorations: Decoration[] = [];
  const continuation = normalizeSuggestionText(suggestion.continuation ?? "");
  const edit = suggestion.edit ? anchorEditSuggestion(doc, safePosition, suggestion.edit) : undefined;

  if (edit) {
    decorations.push(
      Decoration.inline(edit.from, edit.to, {
        class: "md-ai-edit-original"
      }),
      Decoration.widget(
        edit.from,
        () => {
          const node = document.createElement("span");
          node.className = "md-ai-edit-replacement";
          node.textContent = edit.replacement;
          node.contentEditable = "false";
          return node;
        },
        { side: -1 }
      )
    );
  }

  if (continuation) {
    decorations.push(
      Decoration.widget(
        safePosition,
        () => {
          const node = document.createElement("span");
          node.className = "md-ai-suggestion";
          node.textContent = continuation;
          node.contentEditable = "false";
          return node;
        },
        { side: 1 }
      )
    );
  }

  return {
    id,
    position: safePosition,
    ...(continuation ? { continuation } : {}),
    ...(edit ? { edit } : {}),
    decorations: DecorationSet.create(doc, decorations)
  };
}

function normalizeSuggestionText(text: string): string {
  return text.replace(/^\s+/u, "").replace(/\s+$/u, "");
}

function normalizeSuggestion(view: EditorView, suggestion: AiWritingSuggestion): AiWritingSuggestion {
  const continuation = normalizeSuggestionText(suggestion.continuation ?? "");
  const edit = suggestion.edit ? anchorEditSuggestion(view.state.doc, view.state.selection.to, suggestion.edit) : undefined;
  return {
    ...(continuation ? { continuation } : {}),
    ...(edit ? { edit } : {})
  };
}

function anchorEditSuggestion(
  doc: ProseMirrorNode,
  position: number,
  edit: AiWritingEditSuggestion
): AnchoredEditSuggestion | undefined {
  const original = normalizeSuggestionText(edit.original);
  const replacement = normalizeSuggestionText(edit.replacement);
  if (!original || !replacement || original === replacement) {
    return undefined;
  }

  const range = findTextRangeNearPosition(doc, original, position);
  if (!range) {
    return undefined;
  }

  return {
    ...edit,
    original,
    replacement,
    from: range.from,
    to: range.to
  };
}

function findTextRangeNearPosition(
  doc: ProseMirrorNode,
  original: string,
  position: number
): { readonly from: number; readonly to: number } | null {
  type BestMatch = { readonly from: number; readonly to: number; readonly distance: number };
  const matches: BestMatch[] = [];

  doc.descendants((node, nodePosition) => {
    if (!node.isText || !node.text) {
      return;
    }

    let cursor = 0;
    while (cursor <= node.text.length - original.length) {
      const index = node.text.indexOf(original, cursor);
      if (index < 0) {
        break;
      }

      const from = nodePosition + index;
      const to = from + original.length;
      const distance = Math.min(Math.abs(position - from), Math.abs(position - to));
      matches.push({ from, to, distance });
      cursor = index + original.length;
    }
  });

  const result = matches.reduce<BestMatch | null>(
    (best, match) => (!best || match.distance < best.distance ? match : best),
    null
  );
  return result ? { from: result.from, to: result.to } : null;
}
