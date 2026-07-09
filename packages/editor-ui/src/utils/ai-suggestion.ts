import { $prose, markdownToSlice } from "@milkdown/kit/utils";
import type {
  AiCompletionContext,
  AiWritingEditSuggestion,
  AiWritingSuggestion
} from "@md-editor/ai";
import type { EditorMode } from "@md-editor/editor-core";
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

export interface AiEditPreviewModel {
  readonly kind: AiEditPreviewKind;
  readonly textblockFrom: number;
  readonly textblockTo: number;
  readonly before: string;
  readonly original: string;
  readonly replacement: string;
  readonly after: string;
  readonly changes: readonly AiEditPreviewChange[];
}

export interface AiEditPreviewGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface AiEditPreviewTextStyle {
  readonly paddingLeft: string;
  readonly paddingRight: string;
  readonly paddingTop: string;
  readonly fontSize: string;
  readonly font: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly textAlign: string;
  readonly tabSize: string;
}

export interface AiEditPreviewMirrorPlacement {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly font: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly textAlign: string;
  readonly tabSize: string;
}

export type AiEditPreviewKind = "delete-only" | "insert-only" | "mixed";

export interface AiEditPreviewChange {
  readonly originalFrom: number;
  readonly originalTo: number;
  readonly replacementFrom: number;
  readonly replacementTo: number;
  readonly deletedText: string;
  readonly insertedText: string;
}

const aiSuggestionPluginKey = new PluginKey<AiSuggestionState | null>("md-editor-ai-suggestion");
const BEFORE_CONTEXT_CHARS = 3_000;
const AFTER_CONTEXT_CHARS = 1_500;
// Keep edit previews close above the source line box while following each block's text metrics.
const AI_EDIT_PREVIEW_LINE_OFFSET_RATIO = 0.75;
const aiEditPreviewCleanupKey = Symbol("md-editor-ai-edit-preview-cleanup");

type MarkdownSliceParser = (markdown: string) => Slice;

interface AiEditPreviewAnchorElement extends HTMLSpanElement {
  [aiEditPreviewCleanupKey]?: () => void;
}

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
    ? createAiEditAcceptTransactionIfPreviewSupported(view.state, state.edit)
    : createAiContinuationAcceptTransaction(
        view.state,
        state.position,
        state.continuation ?? "",
        parseMarkdownSlice
      );

  if (!transaction) {
    clearAiSuggestion(view);
    return;
  }

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

function createAiEditAcceptTransactionIfPreviewSupported(
  editorState: EditorState,
  edit: AiWritingEditSuggestion & { readonly from: number; readonly to: number }
): Transaction | null {
  if (!createAiEditPreviewModel(editorState.doc, edit)) {
    return null;
  }
  return createAiEditAcceptTransaction(editorState, edit);
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
  const edit = suggestion.edit ? createSupportedAnchoredEditSuggestion(doc, safePosition, suggestion.edit) : undefined;

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
    decorations.push(...createAiEditPreviewDecorations(doc, id, edit));
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

function createAiEditPreviewDecorations(
  doc: ProseMirrorNode,
  id: number,
  edit: AnchoredEditSuggestion
): Decoration[] {
  const model = createAiEditPreviewModel(doc, edit);
  if (!model) {
    return [];
  }

  if (model.kind === "delete-only") {
    return model.changes.map((change) =>
      Decoration.inline(edit.from + change.originalFrom, edit.from + change.originalTo, {
        class: "md-ai-edit-original"
      })
    );
  }

  if (model.kind === "insert-only") {
    return model.changes.map((change, index) =>
      Decoration.widget(
        edit.from + change.originalFrom,
        () => createAiInlineSuggestionNode("md-ai-edit-preview-insert", change.insertedText),
        {
          side: change.originalFrom === 0 ? -1 : 1,
          ignoreSelection: true,
          key: `md-ai-edit-preview-insert-${id}-${index}`
        }
      )
    );
  }

  return [
    Decoration.inline(edit.from, edit.to, {
      class: "md-ai-edit-original"
    }),
    Decoration.widget(
      edit.from,
      (view) => createAiEditPreviewAnchor(view, edit),
      {
        side: -1,
        ignoreSelection: true,
        key: `md-ai-edit-preview-${id}`,
        destroy: (node) => disposeAiEditPreviewAnchor(node as HTMLElement)
      }
    )
  ];
}

function isSelectionAtSuggestionAnchor(selection: Selection, state: AiSuggestionState): boolean {
  return selection.from === state.selectionFrom && selection.to === state.selectionTo;
}

function createAiEditPreviewAnchor(view: EditorView, edit: AnchoredEditSuggestion): HTMLElement {
  // edit preview 镜像当前 textblock 的行盒，只在 overlay 中展示 replacement；
  // 真实文档、选择和历史仍等到 Tab 确认后才改变。
  const anchor = document.createElement("span") as AiEditPreviewAnchorElement;
  anchor.className = "md-ai-edit-preview-anchor";
  anchor.contentEditable = "false";
  anchor.setAttribute("aria-hidden", "true");

  const model = createAiEditPreviewModel(view.state.doc, edit);
  if (!model) {
    return anchor;
  }

  const mirror = createAiEditPreviewMirror(model);
  anchor.append(mirror);
  anchor[aiEditPreviewCleanupKey] = bindAiEditPreviewMirrorPositioning(view, anchor, mirror, model);

  return anchor;
}

function disposeAiEditPreviewAnchor(anchor: HTMLElement): void {
  (anchor as AiEditPreviewAnchorElement)[aiEditPreviewCleanupKey]?.();
  delete (anchor as AiEditPreviewAnchorElement)[aiEditPreviewCleanupKey];
}

function createAiEditPreviewMirror(model: AiEditPreviewModel): HTMLElement {
  const mirror = document.createElement("span");
  mirror.className = "md-ai-edit-preview-mirror";
  mirror.contentEditable = "false";
  mirror.setAttribute("aria-hidden", "true");
  mirror.hidden = true;

  mirror.append(
    createAiEditPreviewTextNode("md-ai-edit-preview-placeholder", model.before),
    createAiEditPreviewTextNode("md-ai-edit-preview-replacement", model.replacement),
    createAiEditPreviewTextNode("md-ai-edit-preview-placeholder", model.after)
  );
  return mirror;
}

function createAiEditPreviewTextNode(className: string, text: string): HTMLElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  node.contentEditable = "false";
  return node;
}

function bindAiEditPreviewMirrorPositioning(
  view: EditorView,
  anchor: HTMLElement,
  mirror: HTMLElement,
  model: AiEditPreviewModel
): () => void {
  const ownerWindow = view.dom.ownerDocument.defaultView;
  const requestFrame =
    ownerWindow?.requestAnimationFrame.bind(ownerWindow) ??
    ((callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number);
  const cancelFrame =
    ownerWindow?.cancelAnimationFrame.bind(ownerWindow) ??
    ((handle: number) =>
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof globalThis.setTimeout>));
  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(() => schedulePositionUpdate())
    : null;
  let frame: number | null = null;
  let disposed = false;
  let observedTextblock: Element | null = null;

  const cleanup = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    resizeObserver?.disconnect();
    ownerWindow?.removeEventListener("resize", schedulePositionUpdate);
    ownerWindow?.removeEventListener("scroll", schedulePositionUpdate, true);
  };

  const updatePosition = () => {
    frame = null;
    if (disposed) {
      return;
    }
    if (!anchor.isConnected) {
      cleanup();
      return;
    }

    const textblock = findAiEditPreviewTextblockDom(view, model);
    if (resizeObserver && textblock !== observedTextblock) {
      if (observedTextblock) {
        resizeObserver.unobserve(observedTextblock);
      }
      if (textblock) {
        resizeObserver.observe(textblock);
      }
      observedTextblock = textblock;
    }

    const isPositioned = positionAiEditPreviewMirror(anchor, mirror, textblock);
    mirror.hidden = !isPositioned;
    if (!isPositioned) {
      clearAiSuggestion(view);
    }
  };

  function schedulePositionUpdate() {
    if (disposed || frame !== null) {
      return;
    }
    frame = requestFrame(updatePosition);
  }

  resizeObserver?.observe(view.dom);
  ownerWindow?.addEventListener("resize", schedulePositionUpdate);
  ownerWindow?.addEventListener("scroll", schedulePositionUpdate, true);
  schedulePositionUpdate();

  return cleanup;
}

function positionAiEditPreviewMirror(
  anchor: HTMLElement,
  mirror: HTMLElement,
  textblock: Element | null
): boolean {
  if (!textblock) {
    return false;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const textblockRect = textblock.getBoundingClientRect();
  const placement = calculateAiEditPreviewMirrorPlacement(
    anchorRect,
    textblockRect,
    getComputedStyle(textblock)
  );
  if (!placement) {
    return false;
  }

  mirror.style.left = placement.left;
  mirror.style.top = placement.top;
  mirror.style.width = placement.width;
  mirror.style.font = placement.font;
  mirror.style.lineHeight = placement.lineHeight;
  mirror.style.letterSpacing = placement.letterSpacing;
  mirror.style.textAlign = placement.textAlign;
  mirror.style.tabSize = placement.tabSize;
  return true;
}

export function calculateAiEditPreviewMirrorPlacement(
  anchorRect: Pick<AiEditPreviewGeometry, "left" | "top">,
  textblockRect: AiEditPreviewGeometry,
  textblockStyle: AiEditPreviewTextStyle
): AiEditPreviewMirrorPlacement | null {
  if (!isAiEditPreviewAnchorPointReady(anchorRect) || !isAiEditPreviewGeometryReady(textblockRect)) {
    return null;
  }

  const paddingLeft = Number.parseFloat(textblockStyle.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(textblockStyle.paddingRight) || 0;
  const paddingTop = Number.parseFloat(textblockStyle.paddingTop) || 0;
  const previewOffset = getAiEditPreviewLineOffset(textblockStyle);
  const contentWidth = textblockRect.width - paddingLeft - paddingRight;
  if (contentWidth <= 0) {
    return null;
  }

  return {
    left: `${textblockRect.left + paddingLeft - anchorRect.left}px`,
    top: `${textblockRect.top + paddingTop - anchorRect.top - previewOffset}px`,
    width: `${contentWidth}px`,
    font: textblockStyle.font,
    lineHeight: textblockStyle.lineHeight,
    letterSpacing: textblockStyle.letterSpacing,
    textAlign: textblockStyle.textAlign,
    tabSize: textblockStyle.tabSize
  };
}

function getAiEditPreviewLineOffset(
  textblockStyle: Pick<AiEditPreviewTextStyle, "fontSize" | "lineHeight">
): number {
  const lineHeight = Number.parseFloat(textblockStyle.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight * AI_EDIT_PREVIEW_LINE_OFFSET_RATIO;
  }

  const fontSize = Number.parseFloat(textblockStyle.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize * 1.2 * AI_EDIT_PREVIEW_LINE_OFFSET_RATIO
    : 0;
}

function findAiEditPreviewTextblockDom(
  view: EditorView,
  model: AiEditPreviewModel
): Element | null {
  const nodeDom = view.nodeDOM(Math.max(0, model.textblockFrom - 1));
  if (isElementNode(nodeDom)) {
    return nodeDom;
  }

  const { node } = view.domAtPos(model.textblockFrom);
  const parent = isElementNode(node) ? node : node.parentElement;
  if (!parent || !view.dom.contains(parent)) {
    return null;
  }
  return parent;
}

function isElementNode(node: Node | null): node is Element {
  return node?.nodeType === 1;
}

function isAiEditPreviewAnchorPointReady(rect: Pick<AiEditPreviewGeometry, "left" | "top">): boolean {
  return Number.isFinite(rect.left) && Number.isFinite(rect.top);
}

export function isAiEditPreviewGeometryReady(
  rect: AiEditPreviewGeometry | null
): boolean {
  return Boolean(
    rect &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
  );
}

export function createAiEditPreviewModel(
  doc: ProseMirrorNode,
  edit: AiWritingEditSuggestion & { readonly from: number; readonly to: number }
): AiEditPreviewModel | null {
  if (edit.from < 0 || edit.to <= edit.from || edit.to > doc.content.size) {
    return null;
  }

  const $from = doc.resolve(edit.from);
  const textblock = $from.parent;
  if (!textblock.isTextblock || textblock.type.spec.code) {
    return null;
  }

  const textblockFrom = $from.start($from.depth);
  const textblockTo = $from.end($from.depth);
  if (edit.from < textblockFrom || edit.to > textblockTo || !isPlainTextblock(textblock)) {
    return null;
  }

  const text = textblock.textBetween(0, textblock.content.size, "", "\ufffc");
  const fromOffset = edit.from - textblockFrom;
  const toOffset = edit.to - textblockFrom;
  const original = normalizeSuggestionText(edit.original);
  const replacement = normalizeSuggestionText(edit.replacement);
  if (
    !original ||
    !replacement ||
    original === replacement ||
    text.slice(fromOffset, toOffset) !== original
  ) {
    return null;
  }

  const changes = createAiEditPreviewChanges(original, replacement);

  return {
    kind: getAiEditPreviewKind(changes),
    textblockFrom,
    textblockTo,
    before: text.slice(0, fromOffset),
    original,
    replacement,
    after: text.slice(toOffset),
    changes
  };
}

function getAiEditPreviewKind(changes: readonly AiEditPreviewChange[]): AiEditPreviewKind {
  if (changes.every((change) => change.deletedText && !change.insertedText)) {
    return "delete-only";
  }
  if (changes.every((change) => change.insertedText && !change.deletedText)) {
    return "insert-only";
  }
  return "mixed";
}

function createAiEditPreviewChanges(
  original: string,
  replacement: string
): readonly AiEditPreviewChange[] {
  return (
    createDeleteOnlyAiEditPreviewChanges(original, replacement) ??
    createInsertOnlyAiEditPreviewChanges(original, replacement) ??
    [createMixedAiEditPreviewChange(original, replacement)]
  );
}

function createDeleteOnlyAiEditPreviewChanges(
  original: string,
  replacement: string
): readonly AiEditPreviewChange[] | null {
  const changes: AiEditPreviewChange[] = [];
  let replacementOffset = 0;
  let current: {
    originalFrom: number;
    originalTo: number;
    deletedText: string;
  } | null = null;

  for (let originalOffset = 0; originalOffset < original.length; originalOffset += 1) {
    const originalCharacter = original.charAt(originalOffset);
    if (
      replacementOffset < replacement.length &&
      originalCharacter === replacement.charAt(replacementOffset)
    ) {
      if (current) {
        changes.push({
          originalFrom: current.originalFrom,
          originalTo: current.originalTo,
          replacementFrom: replacementOffset,
          replacementTo: replacementOffset,
          deletedText: current.deletedText,
          insertedText: ""
        });
        current = null;
      }
      replacementOffset += 1;
      continue;
    }

    if (current) {
      current = {
        originalFrom: current.originalFrom,
        originalTo: originalOffset + 1,
        deletedText: `${current.deletedText}${originalCharacter}`
      };
    } else {
      current = {
        originalFrom: originalOffset,
        originalTo: originalOffset + 1,
        deletedText: originalCharacter
      };
    }
  }

  if (current) {
    changes.push({
      originalFrom: current.originalFrom,
      originalTo: current.originalTo,
      replacementFrom: replacementOffset,
      replacementTo: replacementOffset,
      deletedText: current.deletedText,
      insertedText: ""
    });
  }

  return replacementOffset === replacement.length && changes.length > 0 ? changes : null;
}

function createInsertOnlyAiEditPreviewChanges(
  original: string,
  replacement: string
): readonly AiEditPreviewChange[] | null {
  const changes: AiEditPreviewChange[] = [];
  let originalOffset = 0;
  let current: {
    originalFrom: number;
    replacementFrom: number;
    replacementTo: number;
    insertedText: string;
  } | null = null;

  for (let replacementOffset = 0; replacementOffset < replacement.length; replacementOffset += 1) {
    const replacementCharacter = replacement.charAt(replacementOffset);
    if (
      originalOffset < original.length &&
      original.charAt(originalOffset) === replacementCharacter
    ) {
      if (current) {
        changes.push({
          originalFrom: current.originalFrom,
          originalTo: current.originalFrom,
          replacementFrom: current.replacementFrom,
          replacementTo: current.replacementTo,
          deletedText: "",
          insertedText: current.insertedText
        });
        current = null;
      }
      originalOffset += 1;
      continue;
    }

    if (current) {
      current = {
        originalFrom: current.originalFrom,
        replacementFrom: current.replacementFrom,
        replacementTo: replacementOffset + 1,
        insertedText: `${current.insertedText}${replacementCharacter}`
      };
    } else {
      current = {
        originalFrom: originalOffset,
        replacementFrom: replacementOffset,
        replacementTo: replacementOffset + 1,
        insertedText: replacementCharacter
      };
    }
  }

  if (current) {
    changes.push({
      originalFrom: current.originalFrom,
      originalTo: current.originalFrom,
      replacementFrom: current.replacementFrom,
      replacementTo: current.replacementTo,
      deletedText: "",
      insertedText: current.insertedText
    });
  }

  return originalOffset === original.length && changes.length > 0 ? changes : null;
}

function createMixedAiEditPreviewChange(original: string, replacement: string): AiEditPreviewChange {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(original.length, replacement.length);
  while (
    prefixLength < maxPrefixLength &&
    original[prefixLength] === replacement[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = maxPrefixLength - prefixLength;
  while (
    suffixLength < maxSuffixLength &&
    original[original.length - suffixLength - 1] === replacement[replacement.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  return {
    originalFrom: prefixLength,
    originalTo: original.length - suffixLength,
    replacementFrom: prefixLength,
    replacementTo: replacement.length - suffixLength,
    deletedText: original.slice(prefixLength, original.length - suffixLength),
    insertedText: replacement.slice(prefixLength, replacement.length - suffixLength)
  };
}

function isPlainTextblock(textblock: ProseMirrorNode): boolean {
  let isPlain = true;
  textblock.forEach((child) => {
    if (!child.isText || child.marks.length > 0) {
      isPlain = false;
    }
  });
  return isPlain;
}

function createAiInlineSuggestionNode(className: string, text: string): HTMLElement {
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
  const edit = suggestion.edit
    ? createSupportedAnchoredEditSuggestion(view.state.doc, view.state.selection.to, suggestion.edit)
    : undefined;
  return {
    ...(displayContinuation ? { continuation } : {}),
    ...(edit ? { edit } : {})
  };
}

function createSupportedAnchoredEditSuggestion(
  doc: ProseMirrorNode,
  position: number,
  edit: AiWritingEditSuggestion
): AnchoredEditSuggestion | undefined {
  const anchoredEdit = anchorEditSuggestion(doc, position, edit);
  if (!anchoredEdit || !createAiEditPreviewModel(doc, anchoredEdit)) {
    return undefined;
  }
  return anchoredEdit;
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
