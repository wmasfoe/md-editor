import { $prose, markdownToSlice } from "@milkdown/kit/utils";
import type {
  AiCompletionContext,
  AiWritingEditSuggestion,
  AiWritingSuggestion,
  EditorMode
} from "@md-editor/editor-core";
import type { Node as ProseMirrorNode, Slice } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

interface AiSuggestionState {
  readonly id: number;
  readonly position: number;
  readonly selectionFrom: number;
  readonly selectionTo: number;
  readonly continuation?: string;
  readonly edit?: AnchoredEditSuggestion;
  readonly decorations: DecorationSet;
}

type AiSuggestionMeta =
  | {
      readonly type: "show";
      readonly id: number;
      readonly position: number;
      readonly selectionFrom: number;
      readonly selectionTo: number;
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

type MarkdownSliceParser = (markdown: string) => Slice;

export const aiSuggestionPlugin = $prose(
  (ctx) =>
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
            return createAiSuggestionState(
              transaction.doc,
              meta.id,
              meta.position,
              meta.selectionFrom,
              meta.selectionTo,
              meta.suggestion
            );
          }
          if (!previous) {
            return null;
          }
          if (
            transaction.docChanged ||
            (transaction.selectionSet && !isSelectionAtSuggestionAnchor(transaction.selection, previous))
          ) {
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

          if (event.key === "Tab" && (state.edit || state.continuation)) {
            event.preventDefault();
            acceptAiSuggestion(view, state, (markdown) => markdownToSlice(markdown)(ctx));
            requestAnimationFrame(() => view.focus());
            return true;
          }

          if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight" && state.continuation) {
            event.preventDefault();
            acceptAiSuggestion(view, { ...state, edit: undefined }, (markdown) => markdownToSlice(markdown)(ctx));
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
  const selection = view.state.selection;

  view.dispatch(
    view.state.tr
      // 展示 ghost text 不能移动真实光标。这里显式写回当前选区，
      // 让 ProseMirror 在新增 widget 后重新同步 DOM 光标位置。
      .setSelection(selection)
      .setMeta(aiSuggestionPluginKey, {
        type: "show",
        id,
        position: selection.to,
        selectionFrom: selection.from,
        selectionTo: selection.to,
        suggestion: normalizedSuggestion
      } satisfies AiSuggestionMeta)
  );
}

function acceptAiSuggestion(
  view: EditorView,
  state: AiSuggestionState,
  parseMarkdownSlice: MarkdownSliceParser
): void {
  // Tab 是用户确认 suggestion 的统一入口；如果同一轮同时有纠错和续写，
  // 先接受更局部的纠错，避免一次按键写入两类不同语义的模型输出。
  const transaction = state.edit
    ? createAiEditAcceptTransaction(view.state, state.edit)
    : createAiContinuationAcceptTransaction(
        view.state,
        state.position,
        state.continuation ?? "",
        parseMarkdownSlice
      );

  view.dispatch(
    transaction
      .setMeta(aiSuggestionPluginKey, { type: "clear" } satisfies AiSuggestionMeta)
      .scrollIntoView()
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

export function createAiEditAcceptTransaction(
  editorState: EditorState,
  edit: AiWritingEditSuggestion & { readonly from: number; readonly to: number }
): Transaction {
  return editorState.tr.insertText(edit.replacement, edit.from, edit.to);
}

export function createAiContinuationAcceptTransaction(
  editorState: EditorState,
  position: number,
  continuation: string,
  parseMarkdownSlice: MarkdownSliceParser
): Transaction {
  const safePosition = Math.max(0, Math.min(position, editorState.doc.content.size));
  const markdownContinuation = normalizeContinuationMarkdown(continuation);
  const fallbackText = normalizeSuggestionText(markdownContinuation);
  const insertionPosition = getContinuationInsertionPosition(editorState, safePosition, markdownContinuation);

  // AI 续写可能包含列表、标题等 Markdown 块语法。先交给 Milkdown 解析，
  // 避免纯文本插入后把 `1.` 或 `-` 序列化成被转义的普通字符。
  try {
    const slice = parseMarkdownSlice(markdownContinuation);
    if (slice.content.size > 0) {
      return setSelectionAfterInsertedContent(
        editorState.tr.replace(insertionPosition, insertionPosition, slice)
      );
    }
  } catch {
    // 解析失败时回退到纯文本插入，保证用户确认后不会丢弃模型输出。
  }

  return editorState.tr.insertText(fallbackText, safePosition, safePosition);
}

function setSelectionAfterInsertedContent(transaction: Transaction): Transaction {
  const changedRange = transaction.changedRange();
  const cursorPosition = Math.min(
    changedRange?.to ?? transaction.selection.to,
    transaction.doc.content.size
  );
  return transaction.setSelection(Selection.near(transaction.doc.resolve(cursorPosition), 1));
}

function getContinuationInsertionPosition(
  editorState: EditorState,
  position: number,
  continuation: string
): number {
  if (!hasLeadingLineBreak(continuation)) {
    return position;
  }

  const resolvedPosition = editorState.doc.resolve(position);
  if (resolvedPosition.depth === 0 || !resolvedPosition.parent.isTextblock) {
    return position;
  }

  const topLevelNode = resolvedPosition.node(1);
  if (topLevelNode.type.spec.code) {
    return position;
  }

  return Math.min(resolvedPosition.after(1), editorState.doc.content.size);
}

function hasLeadingLineBreak(value: string): boolean {
  return /^[\t ]*\r?\n/u.test(value);
}

function createAiSuggestionState(
  doc: ProseMirrorNode,
  id: number,
  position: number,
  selectionFrom: number,
  selectionTo: number,
  suggestion: AiWritingSuggestion
): AiSuggestionState {
  const safePosition = Math.max(0, Math.min(position, doc.content.size));
  const continuation = normalizeContinuationMarkdown(suggestion.continuation ?? "");
  const displayContinuation = normalizeSuggestionText(continuation);
  const edit = suggestion.edit ? anchorEditSuggestion(doc, safePosition, suggestion.edit) : undefined;

  return createDecoratedAiSuggestionState({
    doc,
    id,
    position: safePosition,
    selectionFrom,
    selectionTo,
    continuation: displayContinuation ? continuation : undefined,
    edit
  });
}

function createDecoratedAiSuggestionState({
  doc,
  id,
  position,
  selectionFrom,
  selectionTo,
  continuation,
  edit
}: {
  readonly doc: ProseMirrorNode;
  readonly id: number;
  readonly position: number;
  readonly selectionFrom: number;
  readonly selectionTo: number;
  readonly continuation?: string;
  readonly edit?: AnchoredEditSuggestion;
}): AiSuggestionState {
  const decorations: Decoration[] = [];
  const displayContinuation = continuation ? normalizeSuggestionText(continuation) : "";

  if (edit) {
    decorations.push(
      Decoration.inline(edit.from, edit.to, {
        class: "md-ai-edit-original"
      })
    );

    decorations.push(
      Decoration.widget(
        edit.from,
        (view) => createAiEditPreviewAnchor(view, edit),
        {
          side: -1,
          ignoreSelection: true,
          key: `md-ai-edit-preview-${id}`
        }
      )
    );
  }

  if (displayContinuation) {
    decorations.push(
      Decoration.widget(
        position,
        () => {
          return createAiInlineSuggestionNode("md-ai-suggestion", ` ${displayContinuation}`);
        },
        {
          side: 1,
          ignoreSelection: true,
          key: `md-ai-continuation-${id}`
        }
      )
    );
  }

  return {
    id,
    position,
    selectionFrom,
    selectionTo,
    ...(continuation ? { continuation } : {}),
    ...(edit ? { edit } : {}),
    decorations: DecorationSet.create(doc, decorations)
  };
}

function isSelectionAtSuggestionAnchor(selection: Selection, state: AiSuggestionState): boolean {
  return selection.from === state.selectionFrom && selection.to === state.selectionTo;
}

function createAiEditPreviewAnchor(view: EditorView, edit: AnchoredEditSuggestion): HTMLElement {
  // edit preview 是 Tab 前的绝对定位浮层。它只负责展示建议，不参与正文排版，
  // 因此不会把原始文本向下推；Tab 接受时才真正替换 Markdown。
  const anchor = document.createElement("span");
  anchor.className = "md-ai-edit-preview-anchor";
  anchor.contentEditable = "false";

  const preview = document.createElement("span");
  preview.className = "md-ai-edit-preview";
  preview.textContent = edit.replacement;
  anchor.append(preview);

  requestAnimationFrame(() => setAiEditPreviewWidth(view, anchor));
  return anchor;
}

function setAiEditPreviewWidth(view: EditorView, anchor: HTMLElement): void {
  if (!anchor.isConnected) {
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const editorRect = view.dom.getBoundingClientRect();
  const editorStyle = getComputedStyle(view.dom);
  const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
  const contentRight = editorRect.right - paddingRight;
  const remainingWidth = Math.max(1, Math.floor(contentRight - anchorRect.left));

  anchor.style.setProperty("--md-ai-edit-preview-width", `${remainingWidth}px`);
}

function createAiInlineSuggestionNode(className: string, text: string): HTMLElement {
  // continuation 仍是光标后的 ghost text。edit suggestion 走上面的对比预览，
  // 避免把语法/标点替换误渲染成已经接受的正文。
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  node.contentEditable = "false";
  return node;
}

function normalizeSuggestionText(text: string): string {
  return text.replace(/^\s+/u, "").replace(/\s+$/u, "");
}

function normalizeContinuationMarkdown(text: string): string {
  return text.replace(/^[\t ]+/u, "").replace(/\s+$/u, "");
}

function normalizeSuggestion(view: EditorView, suggestion: AiWritingSuggestion): AiWritingSuggestion {
  const continuation = normalizeContinuationMarkdown(suggestion.continuation ?? "");
  const displayContinuation = normalizeSuggestionText(continuation);
  const edit = suggestion.edit ? anchorEditSuggestion(view.state.doc, view.state.selection.to, suggestion.edit) : undefined;
  return {
    ...(displayContinuation ? { continuation } : {}),
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
