import { parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "@milkdown/kit/prose/view";
import { $ctx, $prose } from "@milkdown/kit/utils";
import { findWysiwygMarkdownLinkDraft, isEscapedCharacter } from "./wysiwyg-markdown-link-draft";
import {
  createWysiwygMarkdownSourceSession,
  findWysiwygMarkdownSourceTarget,
  isWysiwygMarkdownImagePreviewReady,
  isWysiwygMarkdownSourceNode,
  replaceWysiwygMarkdownSourceNodeWithParsed,
  replaceWysiwygMarkdownSourceTargetWithDraft,
  resolveWysiwygMarkdownSourceReplacement,
  updateWysiwygMarkdownImagePreviewState,
  updateWysiwygMarkdownSourceNodeDraft,
  wysiwygMarkdownBlockSourceNodeName,
  wysiwygMarkdownInlineSourceNodeName,
  type MarkdownDocumentParser,
  type MarkdownDocumentSerializer,
  type WysiwygMarkdownSourceReplacement,
  type WysiwygMarkdownSourceKind,
  type WysiwygMarkdownSourceSession,
  type WysiwygMarkdownSourceTarget,
} from "./wysiwyg-markdown-source";
import {
  createSourceEditorDom,
  createSourceEditorShell,
  flattenSourceEditorText,
  getSourceEditorSelectionOffset,
  readSourceEditorText,
  renderPlainSourceEditorText,
  renderSegmentedSourceEditorText,
  setSourceEditorSelectionOffset,
} from "./wysiwyg-markdown-source-editor";

export interface WysiwygMarkdownSourcePluginState {
  readonly session: WysiwygMarkdownSourceSession | null;
  readonly decorations: DecorationSet;
}

export interface WysiwygMarkdownSourceRuntimeConfig {
  readonly includeImages: boolean;
  readonly getAuthorImageSrc: (previewSrc: string) => string;
  readonly resolveImageSrc: (authorSrc: string) => string;
  readonly registerImageSource: (previewSrc: string, authorSrc: string) => void;
  readonly imagePreviewDebounceMs: number;
}

export interface WysiwygMarkdownSourcePluginOptions {
  readonly serialize: MarkdownDocumentSerializer;
  readonly parse: MarkdownDocumentParser;
  readonly getAuthorImageSrc?: (previewSrc: string) => string;
  readonly resolveImageSrc?: (authorSrc: string) => string;
  readonly registerImageSource?: (previewSrc: string, authorSrc: string) => void;
  readonly imagePreviewDebounceMs?: number;
  readonly includeImages?: boolean;
}

export interface WysiwygMarkdownImagePreview {
  readonly authorSrc: string;
  readonly previewSrc: string;
  readonly alt: string;
}

interface WysiwygMarkdownSourcePluginMeta {
  readonly suppressReveal?: boolean;
}

export const wysiwygMarkdownSourcePluginKey = new PluginKey<WysiwygMarkdownSourcePluginState>(
  "md-editor-wysiwyg-markdown-source",
);

const defaultWysiwygMarkdownSourceRuntimeConfig: WysiwygMarkdownSourceRuntimeConfig = {
  includeImages: false,
  getAuthorImageSrc: (src) => src,
  resolveImageSrc: (src) => src,
  registerImageSource: () => undefined,
  imagePreviewDebounceMs: 180,
};

export const wysiwygMarkdownSourceConfig = $ctx(
  defaultWysiwygMarkdownSourceRuntimeConfig,
  "wysiwygMarkdownSourceConfig",
);

export const wysiwygMarkdownSourcePlugin = $prose((ctx) => {
  const runtimeConfig = ctx.get(wysiwygMarkdownSourceConfig.key);
  // `$prose` only waits for SchemaReady. At that moment serializerCtx/parserCtx still
  // hold Milkdown's default outOfScope stubs; capturing them here freezes the stubs and
  // later throws "Should not call a context out of the plugin" when revealing headings
  // or marks. Resolve on each call so the first use runs after EditorState waits for
  // SerializerReady / ParserReady.
  return createWysiwygMarkdownSourceProsePlugin({
    serialize: (doc) => ctx.get(serializerCtx)(doc),
    parse: (markdown) => ctx.get(parserCtx)(markdown),
    ...runtimeConfig,
  });
});

export function createWysiwygMarkdownSourceProsePlugin(
  options: WysiwygMarkdownSourcePluginOptions,
): Plugin<WysiwygMarkdownSourcePluginState> {
  const {
    serialize,
    parse,
    getAuthorImageSrc,
    resolveImageSrc = (src) => src,
    registerImageSource = () => undefined,
    imagePreviewDebounceMs = 180,
    includeImages = false,
  } = options;
  const rawSourceNodeView = (
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) =>
    createRawSourceNodeView(node, view, getPos, {
      parse,
      resolveImageSrc,
      imagePreviewDebounceMs,
    });

  return new Plugin<WysiwygMarkdownSourcePluginState>({
    key: wysiwygMarkdownSourcePluginKey,
    state: {
      init: (_, state) => createPluginState(state, serialize, getAuthorImageSrc, includeImages),
      apply: (transaction, _, __, state) => {
        const meta = transaction.getMeta(
          wysiwygMarkdownSourcePluginKey,
        ) as WysiwygMarkdownSourcePluginMeta | null;
        return meta?.suppressReveal
          ? { session: null, decorations: DecorationSet.empty }
          : createPluginState(state, serialize, getAuthorImageSrc, includeImages);
      },
    },
    props: {
      decorations: (state) =>
        wysiwygMarkdownSourcePluginKey.getState(state)?.decorations ?? DecorationSet.empty,
      nodeViews: {
        [wysiwygMarkdownInlineSourceNodeName]: rawSourceNodeView,
        [wysiwygMarkdownBlockSourceNodeName]: rawSourceNodeView,
      },
      handleTextInput(view, from, to, text) {
        if (from !== to || view.composing) {
          return false;
        }

        const $from = view.state.doc.resolve(from);
        const activeMarks = view.state.storedMarks ?? $from.marks();
        if (
          !$from.parent.isTextblock ||
          $from.parent.type.spec.code ||
          activeMarks.some((mark) => mark.type.spec.code)
        ) {
          return false;
        }

        const before = $from.parent.textBetween(0, $from.parentOffset, "", "");
        const match = findWysiwygMarkdownLinkDraft(before, text);
        if (!match) {
          return false;
        }

        const imageMarkerOffset = match.startOffset - 1;
        const isImage =
          imageMarkerOffset >= 0 &&
          before[imageMarkerOffset] === "!" &&
          !isEscapedCharacter(before, imageMarkerOffset);
        const source = isImage ? `!${match.source}` : match.source;

        const target: WysiwygMarkdownSourceTarget = {
          kind: isImage ? "image" : "link",
          layout: isImage ? "image" : "inline",
          from: $from.start() + (isImage ? imageMarkerOffset : match.startOffset),
          to,
          source,
          sourceCursorOffset: source.length,
        };
        const transaction = replaceWysiwygMarkdownSourceTargetWithDraft(
          view.state.tr,
          target,
          source,
          source.length,
        );
        if (!transaction) {
          return false;
        }

        view.dispatch(transaction.scrollIntoView());
        return true;
      },
    },
    appendTransaction(transactions, _, state) {
      if (
        transactions.some((transaction) => transaction.getMeta("md-editor-source-session-commit"))
      ) {
        return null;
      }

      const candidate = findCommittableRawSourceNode(state);
      if (!candidate) {
        return null;
      }

      const kind = readSourceKind(candidate.node.attrs.kind);
      if (!kind) {
        return null;
      }

      let replacement;
      try {
        replacement = resolveWysiwygMarkdownSourceReplacement(
          kind,
          String(candidate.node.attrs.source ?? ""),
          parse,
        );
      } catch {
        return null;
      }
      if (!replacement) {
        return null;
      }

      if (
        kind === "image" &&
        !isWysiwygMarkdownImagePreviewReady(
          candidate.node,
          String(candidate.node.attrs.source ?? ""),
        )
      ) {
        return null;
      }

      replacement = prepareImageReplacement(kind, candidate.node, replacement, registerImageSource);

      const transaction = replaceWysiwygMarkdownSourceNodeWithParsed(
        state.tr,
        candidate.position,
        replacement,
      );
      if (!transaction) {
        return null;
      }

      const candidateEnd = candidate.position + candidate.node.nodeSize;
      if (
        state.selection.empty &&
        (state.selection.from === candidate.position || state.selection.from === candidateEnd)
      ) {
        transaction.setMeta(wysiwygMarkdownSourcePluginKey, { suppressReveal: true });
      }
      return transaction;
    },
    view(view) {
      let revealKey: string | null = null;

      const focusReveal = (nextView: EditorView) => {
        const session = wysiwygMarkdownSourcePluginKey.getState(nextView.state)?.session ?? null;
        const nextKey = session ? getTargetKey(session.target) : null;
        if (!session || nextKey === revealKey) {
          revealKey = nextKey;
          return;
        }

        revealKey = nextKey;
        scheduleSourceEditorFocus(
          nextView,
          `[data-md-source-reveal="${nextKey}"]`,
          session.sourceCursorOffset,
        );
      };

      focusReveal(view);
      return {
        update: focusReveal,
        destroy() {
          revealKey = null;
        },
      };
    },
  });
}

export function resolveWysiwygMarkdownImagePreview(
  source: string,
  parse: MarkdownDocumentParser,
  resolveImageSrc: (authorSrc: string) => string = (src) => src,
): WysiwygMarkdownImagePreview | null {
  let replacement: WysiwygMarkdownSourceReplacement | null;
  try {
    replacement = resolveWysiwygMarkdownSourceReplacement("image", source, parse);
  } catch {
    return null;
  }

  const image = replacement?.content.firstChild;
  if (!image || image.type.name !== "image") {
    return null;
  }

  const authorSrc = String(image.attrs.src ?? "");
  let previewSrc: string;
  try {
    previewSrc = resolveImageSrc(authorSrc);
  } catch {
    return null;
  }

  if (!previewSrc.trim()) {
    return null;
  }

  return {
    authorSrc,
    previewSrc,
    alt: String(image.attrs.alt ?? ""),
  };
}

function prepareImageReplacement(
  kind: WysiwygMarkdownSourceKind,
  sourceNode: ProseMirrorNode,
  replacement: WysiwygMarkdownSourceReplacement,
  registerImageSource: (previewSrc: string, authorSrc: string) => void,
): WysiwygMarkdownSourceReplacement {
  if (kind !== "image") {
    return replacement;
  }

  const image = replacement.content.firstChild;
  const previewSrc = String(sourceNode.attrs.imagePreviewSrc ?? "");
  if (!image || image.type.name !== "image" || !previewSrc) {
    return replacement;
  }

  const authorSrc = String(image.attrs.src ?? "");
  if (previewSrc !== authorSrc) {
    registerImageSource(previewSrc, authorSrc);
  }

  const previewImage = image.type.create(
    { ...image.attrs, src: previewSrc },
    image.content,
    image.marks,
  );
  return {
    ...replacement,
    content: replacement.content.replaceChild(0, previewImage),
  };
}

function createPluginState(
  state: EditorState,
  serialize: MarkdownDocumentSerializer,
  getAuthorImageSrc: ((previewSrc: string) => string) | undefined,
  includeImages: boolean,
): WysiwygMarkdownSourcePluginState {
  const target = findWysiwygMarkdownSourceTarget(state, serialize, getAuthorImageSrc);
  if (!target || (target.kind === "image" && !includeImages)) {
    return { session: null, decorations: DecorationSet.empty };
  }

  const session = createWysiwygMarkdownSourceSession(target);
  return {
    session,
    decorations: createRevealDecorations(state.doc, session),
  };
}

function createRevealDecorations(
  doc: ProseMirrorNode,
  session: WysiwygMarkdownSourceSession,
): DecorationSet {
  const { target } = session;
  const revealKey = getTargetKey(target);
  const widget = Decoration.widget(
    target.from,
    (view) => createRevealSourceEditor(view, session, revealKey),
    {
      key: `${revealKey}:${target.sourceCursorOffset}`,
      side: -1,
      stopEvent: () => true,
    },
  );
  if (target.layout === "image") {
    return DecorationSet.create(doc, [widget]);
  }

  const hidden =
    target.layout === "block"
      ? Decoration.node(target.from, target.to, {
          class: "md-wysiwyg-source-target md-wysiwyg-source-target--hidden",
        })
      : Decoration.inline(target.from, target.to, {
          class: "md-wysiwyg-source-target md-wysiwyg-source-target--hidden",
        });

  return DecorationSet.create(doc, [widget, hidden]);
}

function createRevealSourceEditor(
  view: EditorView,
  session: WysiwygMarkdownSourceSession,
  revealKey: string,
): HTMLElement {
  const editor = createSourceEditorDom(view.dom.ownerDocument, session.target.layout);
  const dom = createSourceEditorShell(view.dom.ownerDocument, session.target.layout);
  editor.dataset.mdSourceReveal = revealKey;
  renderSegmentedSourceEditorText(editor, session.target.kind, session.draft);
  dom.append(editor);
  let composing = false;

  const convertToRawSource = () => {
    if (composing || view.composing) {
      return;
    }

    const current = wysiwygMarkdownSourcePluginKey.getState(view.state)?.session;
    if (!current || getTargetKey(current.target) !== revealKey) {
      return;
    }

    const draft = readSourceEditorText(editor);
    const sourceCursorOffset = getSourceEditorSelectionOffset(editor);
    const transaction = replaceWysiwygMarkdownSourceTargetWithDraft(
      view.state.tr,
      current.target,
      draft,
      sourceCursorOffset,
    );
    if (transaction) {
      view.dispatch(transaction.scrollIntoView());
    }
  };

  editor.addEventListener("mousedown", stopSourceEditorPointerPropagation);
  editor.addEventListener("click", stopSourceEditorPointerPropagation);
  editor.addEventListener("beforeinput", () => flattenSourceEditorText(editor));
  editor.addEventListener("input", convertToRawSource);
  editor.addEventListener("compositionstart", () => {
    composing = true;
  });
  editor.addEventListener("compositionend", () => {
    composing = false;
    convertToRawSource();
  });
  editor.addEventListener("keydown", (event) => {
    handleSourceEditorBoundaryKey(view, editor, session.target, event);
  });

  return dom;
}

interface RawSourceNodeViewOptions {
  readonly parse: MarkdownDocumentParser;
  readonly resolveImageSrc: (authorSrc: string) => string;
  readonly imagePreviewDebounceMs: number;
}

export function createWysiwygImagePreviewRequestGate() {
  let currentRequestId = 0;
  return {
    begin: () => {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent: (requestId: number) => requestId === currentRequestId,
    invalidate: () => {
      currentRequestId += 1;
    },
  };
}

interface RawImagePreviewController {
  schedule(source: string): void;
  destroy(): void;
}

function createRawImagePreviewController(
  previewImage: HTMLImageElement,
  initialNode: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
  options: RawSourceNodeViewOptions,
): RawImagePreviewController {
  const ownerDocument = view.dom.ownerDocument;
  let timer: number | null = null;
  let lastScheduledSource: string | null = null;
  let activeSource: string | null = null;
  let activeLoader: HTMLImageElement | null = null;
  const requestGate = createWysiwygImagePreviewRequestGate();

  const clearTimer = () => {
    if (timer === null) {
      return;
    }
    ownerDocument.defaultView?.clearTimeout(timer);
    timer = null;
  };

  const persistState = (
    source: string,
    previewSrc: string,
    status: "loading" | "loaded" | "failed",
  ) => {
    const position = getPos();
    if (typeof position !== "number") {
      return;
    }

    const current = view.state.doc.nodeAt(position);
    if (!current || String(current.attrs.source ?? "") !== source) {
      return;
    }

    const transaction = updateWysiwygMarkdownImagePreviewState(
      view.state.tr,
      position,
      source,
      previewSrc,
      status,
    );
    if (transaction) {
      view.dispatch(transaction);
    }
  };

  const apply = (source: string, persist: boolean) => {
    const requestId = requestGate.begin();
    activeLoader = null;
    const preview = resolveWysiwygMarkdownImagePreview(
      source,
      options.parse,
      options.resolveImageSrc,
    );
    if (!preview) {
      activeSource = null;
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      previewImage.alt = "";
      if (persist) {
        persistState(source, "", "failed");
      }
      return;
    }

    activeSource = source;
    previewImage.hidden = true;
    previewImage.alt = preview.alt;
    const loader = ownerDocument.createElement("img");
    activeLoader = loader;

    const isCurrentRequest = () =>
      requestGate.isCurrent(requestId) && activeLoader === loader && activeSource === source;
    const handleLoad = () => {
      if (!isCurrentRequest()) {
        return;
      }
      previewImage.src = preview.previewSrc;
      previewImage.alt = preview.alt;
      previewImage.hidden = false;
      if (persist) {
        persistState(source, preview.previewSrc, "loaded");
      }
    };
    const handleError = () => {
      if (!isCurrentRequest()) {
        return;
      }
      previewImage.hidden = true;
      previewImage.removeAttribute("src");
      if (persist) {
        persistState(source, preview.previewSrc, "failed");
      }
    };

    loader.addEventListener("load", handleLoad, { once: true });
    loader.addEventListener("error", handleError, { once: true });
    loader.src = preview.previewSrc;
    if (loader.complete) {
      if (loader.naturalWidth > 0) {
        handleLoad();
      } else {
        handleError();
      }
    } else if (persist) {
      persistState(source, preview.previewSrc, "loading");
    }
  };

  const schedule = (source: string) => {
    if (source === lastScheduledSource) {
      return;
    }

    lastScheduledSource = source;
    clearTimer();
    const applyCurrentSource = () => {
      timer = null;
      apply(source, true);
    };
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) {
      applyCurrentSource();
      return;
    }
    timer = ownerWindow.setTimeout(applyCurrentSource, Math.max(0, options.imagePreviewDebounceMs));
  };

  previewImage.dataset.mdSourceImagePreview = "true";
  previewImage.setAttribute("contenteditable", "false");
  previewImage.draggable = false;
  previewImage.hidden = true;

  // Keep the last rendered image visible until the debounced draft is ready.
  const originalSource = String(initialNode.attrs.originalSource ?? "");
  if (originalSource) {
    apply(originalSource, false);
  }

  return {
    schedule,
    destroy() {
      clearTimer();
      requestGate.invalidate();
      activeLoader = null;
      activeSource = null;
    },
  };
}

function createRawSourceNodeView(
  initialNode: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
  options: RawSourceNodeViewOptions,
): NodeView {
  let node = initialNode;
  let composing = false;
  const kind = readSourceKind(node.attrs.kind) ?? "link";
  const layout =
    kind === "image"
      ? "image"
      : node.type.name === wysiwygMarkdownBlockSourceNodeName
        ? "block"
        : "inline";
  const ownerDocument = view.dom.ownerDocument;
  const editor = createSourceEditorDom(ownerDocument, layout);
  editor.classList.add("md-wysiwyg-markdown-source--raw");
  const previewImage = kind === "image" ? ownerDocument.createElement("img") : null;
  const dom = createSourceEditorShell(ownerDocument, layout);
  dom.append(editor);

  if (previewImage) {
    dom.classList.add("md-wysiwyg-image-source");
    dom.dataset.mdSourceImageEditor = "true";
    dom.append(previewImage);
  }
  const imagePreviewController = previewImage
    ? createRawImagePreviewController(previewImage, initialNode, view, getPos, options)
    : null;

  const render = (nextNode: ProseMirrorNode) => {
    node = nextNode;
    const nextKind = readSourceKind(node.attrs.kind) ?? "link";
    const source = String(node.attrs.source ?? "");
    if (!composing && readSourceEditorText(editor) !== source) {
      renderPlainSourceEditorText(editor, nextKind, source);
    }
    imagePreviewController?.schedule(source);
  };
  const selectNode = () => {
    dom.classList.add("ProseMirror-selectednode");
    const sourceCursorOffset = Number(node.attrs.sourceCursorOffset ?? 0);
    scheduleElementFocus(editor, sourceCursorOffset);
  };
  const persist = () => {
    if (composing || view.composing) {
      return;
    }

    const position = getPos();
    if (typeof position !== "number") {
      return;
    }
    const source = readSourceEditorText(editor);
    const sourceCursorOffset = getSourceEditorSelectionOffset(editor);
    const transaction = updateWysiwygMarkdownSourceNodeDraft(
      view.state.tr,
      position,
      source,
      sourceCursorOffset,
    );
    if (transaction) {
      view.dispatch(transaction);
    }
  };

  render(node);
  editor.addEventListener("mousedown", stopSourceEditorPointerPropagation);
  editor.addEventListener("click", stopSourceEditorPointerPropagation);
  editor.addEventListener("focus", () => {
    const position = getPos();
    if (typeof position !== "number") {
      return;
    }
    const selection = view.state.selection;
    if (!(selection instanceof NodeSelection) || selection.from !== position) {
      view.dispatch(
        view.state.tr
          .setSelection(NodeSelection.create(view.state.doc, position))
          .setMeta("addToHistory", false),
      );
    }
  });
  editor.addEventListener("input", persist);
  editor.addEventListener("compositionstart", () => {
    composing = true;
  });
  editor.addEventListener("compositionend", () => {
    composing = false;
    persist();
  });
  editor.addEventListener("keydown", (event) => {
    const position = getPos();
    if (typeof position !== "number") {
      return;
    }
    handleSourceEditorBoundaryKey(
      view,
      editor,
      {
        kind: readSourceKind(node.attrs.kind) ?? "link",
        layout,
        from: position,
        to: position + node.nodeSize,
        source: String(node.attrs.source ?? ""),
        sourceCursorOffset: Number(node.attrs.sourceCursorOffset ?? 0),
      },
      event,
    );
  });

  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type || (readSourceKind(nextNode.attrs.kind) ?? "link") !== kind) {
        return false;
      }
      render(nextNode);
      return true;
    },
    selectNode,
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
    },
    stopEvent: (event) => dom.contains(event.target as Node),
    ignoreMutation: () => true,
    destroy() {
      imagePreviewController?.destroy();
    },
  };
}

function findCommittableRawSourceNode(
  state: EditorState,
): { readonly node: ProseMirrorNode; readonly position: number } | null {
  let candidate: { node: ProseMirrorNode; position: number } | null = null;
  state.doc.descendants((node, position) => {
    if (!isWysiwygMarkdownSourceNode(node)) {
      return;
    }
    if (selectionTouchesNode(state.selection, position, node.nodeSize)) {
      return false;
    }
    candidate = { node, position };
    return false;
  });
  return candidate;
}

function selectionTouchesNode(selection: Selection, position: number, nodeSize: number): boolean {
  const to = position + nodeSize;
  if (selection instanceof NodeSelection) {
    return selection.from === position && selection.to === to;
  }
  return !selection.empty && selection.from < to && selection.to > position;
}

function handleSourceEditorBoundaryKey(
  view: EditorView,
  dom: HTMLElement,
  target: WysiwygMarkdownSourceTarget,
  event: KeyboardEvent,
): void {
  const offset = getSourceEditorSelectionOffset(dom);
  const sourceLength = readSourceEditorText(dom).length;
  const exitBackward = event.key === "ArrowLeft" && offset === 0;
  const exitForward =
    (event.key === "ArrowRight" && offset === sourceLength) ||
    event.key === "Tab" ||
    event.key === "Escape";
  if (!exitBackward && !exitForward) {
    return;
  }

  event.preventDefault();
  const direction = exitBackward ? -1 : 1;
  const position = direction < 0 ? target.from : target.to;
  const resolvedPosition = view.state.doc.resolve(position);
  const selection =
    Selection.findFrom(resolvedPosition, direction, true) ??
    Selection.near(resolvedPosition, direction);
  view.dispatch(
    view.state.tr
      .setSelection(selection)
      .setMeta("addToHistory", false)
      .setMeta(wysiwygMarkdownSourcePluginKey, { suppressReveal: true })
      .scrollIntoView(),
  );
  view.focus();
}

function scheduleSourceEditorFocus(
  view: EditorView,
  selector: string,
  sourceCursorOffset: number,
): void {
  scheduleFrame(view.dom.ownerDocument, () => {
    const dom = view.dom.querySelector<HTMLElement>(selector);
    if (dom) {
      focusSourceEditor(dom, sourceCursorOffset);
    }
  });
}

function scheduleElementFocus(dom: HTMLElement, sourceCursorOffset: number): void {
  scheduleFrame(dom.ownerDocument, () => focusSourceEditor(dom, sourceCursorOffset));
}

function scheduleFrame(ownerDocument: Document, callback: () => void): void {
  const ownerWindow = ownerDocument.defaultView;
  if (ownerWindow) {
    ownerWindow.requestAnimationFrame(callback);
  } else {
    callback();
  }
}

function focusSourceEditor(dom: HTMLElement, sourceCursorOffset: number): void {
  dom.focus({ preventScroll: true });
  setSourceEditorSelectionOffset(dom, sourceCursorOffset);
}

function getTargetKey(target: WysiwygMarkdownSourceTarget): string {
  return `${target.kind}-${target.from}-${target.to}`;
}

function readSourceKind(value: unknown): WysiwygMarkdownSourceKind | null {
  switch (value) {
    case "heading":
    case "strong":
    case "emphasis":
    case "strikethrough":
    case "link":
    case "image":
    case "inlineCode":
      return value;
    default:
      return null;
  }
}

function stopSourceEditorPointerPropagation(event: Event): void {
  event.stopPropagation();
}
