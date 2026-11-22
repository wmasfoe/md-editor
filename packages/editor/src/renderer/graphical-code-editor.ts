import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type {
  EditorMessageTranslator,
  GraphicalCodeBlockEditorProvider,
  MarkdownGraphicalCodeBlockMetadata,
  MarkdownRangeRecord,
  SyntaxPluginHostPorts,
} from "@md-editor/plugin-sdk/syntax";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { authorizeWysiwygProtectedChange } from "../wysiwyg/state/change-authorization.ts";
import type { RendererViewAdapter } from "./types.ts";
import { createDefaultSyntaxPluginHostPorts } from "../plugins/syntax-plugin-ports.ts";

/** Consolidates controller lifecycle/protocol guards for editor-owned sessions. */
export function isGraphicalCodeEditorBusy(state: {
  readonly destroyed: boolean;
  readonly documentBusy: boolean;
  readonly hasPendingExternalEdit: boolean;
  readonly hasQueuedExternalEdit: boolean;
  readonly hasPendingModeChange: boolean;
  readonly requiresReconcile: boolean;
}): boolean {
  return (
    state.destroyed ||
    state.documentBusy ||
    state.hasPendingExternalEdit ||
    state.hasQueuedExternalEdit ||
    state.hasPendingModeChange ||
    state.requiresReconcile
  );
}

export interface GraphicalCodeEditorContext {
  readonly view: RendererViewAdapter;
  readonly parent: HTMLElement;
  readonly provider: GraphicalCodeBlockEditorProvider;
  readonly translateEditorMessage?: EditorMessageTranslator | undefined;
  readonly recordId?: string;
  readonly creation?: { readonly anchor: number; readonly initialSource: string };
  readonly getDocumentState: () => {
    readonly documentGeneration: number;
    readonly contentRevision: number;
    readonly stateRevision: number;
  };
  readonly isBusy: () => boolean;
  readonly isComposing: () => boolean;
  readonly isDestroyed: () => boolean;
  readonly isDark: () => boolean;
  readonly signal: AbortSignal;
}

export interface GraphicalCodeEditorCoordinatorContext {
  readonly view: () => RendererViewAdapter;
  readonly parent: HTMLElement;
  readonly translateEditorMessage?: EditorMessageTranslator | undefined;
  readonly getDocumentState: GraphicalCodeEditorContext["getDocumentState"];
  readonly isBusy: () => boolean;
  readonly isComposing: () => boolean;
  readonly isDestroyed: () => boolean;
  readonly isDark: () => boolean;
}

const activeDialogs = new WeakSet<HTMLElement>();

/** Keeps provider routing and dialog lifetime outside the main renderer controller. */
export class GraphicalCodeEditorCoordinator {
  readonly #context: GraphicalCodeEditorCoordinatorContext;
  readonly #abortController = new AbortController();

  constructor(context: GraphicalCodeEditorCoordinatorContext) {
    this.#context = context;
  }

  hostPorts(override?: SyntaxPluginHostPorts): SyntaxPluginHostPorts {
    if (override) {
      return { translateEditorMessage: this.#context.translateEditorMessage, ...override };
    }
    return {
      ...createDefaultSyntaxPluginHostPorts(),
      translateEditorMessage: this.#context.translateEditorMessage,
      openGraphicalCodeBlockEditor: ({ recordId, provider }) => this.openRecord(recordId, provider),
      canOpenGraphicalCodeBlockEditor: (state, recordId) => {
        const record = findTarget(state, recordId);
        return !state.readOnly && record !== null && isSupportedFence(record, state);
      },
      revealCodeBlockSource: ({ recordId }) => {
        const view = this.#context.view();
        if (!this.#available()) return;
        const record = view.state.field(markdownRangeIndexField).get(recordId);
        if (!record) return;
        const anchor = Math.min(
          record.graphicalCodeBlock?.bodyRange.from ??
            record.codeBlock?.bodyEnvelopeRange?.from ??
            record.contentRange?.from ??
            record.fullRange.from,
          record.fullRange.to,
        );
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
        });
        view.focus();
      },
    };
  }

  executeFormatting(
    commandId: string,
    providers: readonly GraphicalCodeBlockEditorProvider[],
  ): boolean | null {
    if (commandId === "edit.mermaid") {
      if (!this.#available()) return false;
      const view = this.#context.view();
      const head = view.state.selection.main.head;
      const record = view.state
        .field(markdownRangeIndexField)
        .records.find(
          ({ nodeName, fullRange }) =>
            nodeName === "MermaidBlock" && fullRange.from <= head && head <= fullRange.to,
        );
      const provider = providers.find(({ id }) => id === "mermaid.graphical.default-layout");
      if (!record || !provider || !isSupportedFence(record, view.state)) return false;
      this.openRecord(record.id, provider);
      return true;
    }
    const match = /^insert\.mermaid\.(flowchart|sequence)$/.exec(commandId);
    if (!match) return null;
    const provider = providers.find((candidate) =>
      candidate.diagramTypes.some(({ id }) => id === match[1]),
    );
    const diagram = provider?.diagramTypes.find(({ id }) => id === match[1]);
    if (!provider || !diagram || !this.#available()) return false;
    const view = this.#context.view();
    const anchor = diagramInsertionPoint(view, view.state.selection.main.head);
    if (anchor === null) return false;
    void this.#launch(provider, { anchor, initialSource: diagram.initialSource });
    return true;
  }

  openRecord(recordId: string, provider: GraphicalCodeBlockEditorProvider): void {
    void this.#launch(provider, { recordId });
  }

  destroy(): void {
    this.#abortController.abort();
  }

  #available(): boolean {
    const { view } = this.#context;
    return (
      !this.#context.isDestroyed() &&
      !this.#context.isBusy() &&
      !this.#context.isComposing() &&
      !view().state.readOnly
    );
  }

  #launch(
    provider: GraphicalCodeBlockEditorProvider,
    target:
      { readonly recordId: string } | { readonly anchor: number; readonly initialSource: string },
  ): Promise<void> {
    const targetContext =
      "recordId" in target ? { recordId: target.recordId } : { creation: target };
    return openGraphicalCodeEditor({
      view: this.#context.view(),
      parent: this.#context.parent,
      provider,
      translateEditorMessage: this.#context.translateEditorMessage,
      ...targetContext,
      getDocumentState: this.#context.getDocumentState,
      isBusy: this.#context.isBusy,
      isComposing: this.#context.isComposing,
      isDestroyed: this.#context.isDestroyed,
      isDark: this.#context.isDark,
      signal: this.#abortController.signal,
    });
  }
}

/** Open a renderer-owned, identity-bound editing session for one fenced code block or new diagram. */
export async function openGraphicalCodeEditor(context: GraphicalCodeEditorContext): Promise<void> {
  const { view, provider } = context;
  const text = (key: string, fallback: string): string =>
    context.translateEditorMessage?.(`editor.diagram.${key}`, fallback) ?? fallback;
  if (activeDialogs.has(context.parent)) return;
  activeDialogs.add(context.parent);
  const start = context.getDocumentState();
  const isCreate = context.creation !== undefined;
  const initial = isCreate ? null : findTarget(view.state, context.recordId!);
  if (isCreate) {
    if (context.creation!.anchor < 0 || context.creation!.anchor > view.state.doc.length) {
      activeDialogs.delete(context.parent);
      return;
    }
  } else if (!initial || !isSupportedFence(initial, view.state)) {
    activeDialogs.delete(context.parent);
    return;
  }
  const initialFence = isCreate ? null : graphicalFence(initial!, view.state);
  if (!isCreate && !initialFence) {
    activeDialogs.delete(context.parent);
    return;
  }
  const source = isCreate
    ? context.creation!.initialSource
    : view.state.doc.sliceString(initialFence!.bodyRange.from, initialFence!.bodyRange.to);
  let inspectionFailure: string | null = null;
  if (!isCreate) {
    try {
      const inspected = await provider.inspect(source, context.translateEditorMessage);
      if (!isCurrent(context, start, initial!)) {
        activeDialogs.delete(context.parent);
        return;
      }
      if (!inspected.supported)
        inspectionFailure =
          inspected.reason ?? text("unsupported", "This diagram source is not supported.");
    } catch (error) {
      if (!isCurrent(context, start, initial!)) {
        activeDialogs.delete(context.parent);
        return;
      }
      inspectionFailure =
        error instanceof Error
          ? error.message
          : text("inspectFailed", "The diagram source could not be checked.");
    }
  } else if (!isAvailable(context)) {
    activeDialogs.delete(context.parent);
    return;
  }

  const document = context.parent.ownerDocument;
  const priorFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "md-editor-graphical-code-editor";
  const title = isCreate ? text("create", "Create diagram") : text("edit", "Edit diagram");
  dialog.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  const editor = document.createElement("div");
  editor.className = "md-editor-graphical-code-editor__surface";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const apply = button(document, text("apply", "Apply"));
  apply.className = "md-editor-graphical-code-editor__apply";
  apply.disabled = true;
  const cancel = button(document, text("cancel", "Cancel"));
  const copy = button(document, text("copy", "Copy draft"));
  copy.className = "md-editor-graphical-code-editor__copy";
  copy.hidden = true;
  const footer = document.createElement("footer");
  footer.className = "md-editor-graphical-code-editor__footer";
  footer.append(status, copy, cancel, apply);
  dialog.append(heading, editor, footer);
  document.body.append(dialog);
  dialog.showModal();

  let draft = source;
  let providerBusy = false;
  let providerReady = false;
  let closed = false;
  const sessionAbortController = new AbortController();
  let mounted: Awaited<ReturnType<GraphicalCodeBlockEditorProvider["mount"]>> | null = null;
  // Declared before `close` reads it: the abort listener can fire before the
  // observer is created, and a `let` referenced early would throw a TDZ error
  // and leave the dialog unclosable.
  let themeObserver: MutationObserver | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    sessionAbortController.abort();
    mounted?.destroy();
    themeObserver?.disconnect();
    context.signal.removeEventListener("abort", close);
    activeDialogs.delete(context.parent);
    dialog.close();
    dialog.remove();
    if (priorFocus instanceof HTMLElement && priorFocus.isConnected && priorFocus !== document.body)
      priorFocus.focus();
    else context.view.focus();
  };
  // A signal that was already aborted never dispatches `abort` to new listeners,
  // so the listener alone would leave this dialog (and its modal slot) stuck.
  if (context.signal.aborted) {
    close();
    return;
  }
  context.signal.addEventListener("abort", close, { once: true });
  const failClosed = (message: string) => {
    status.textContent = message;
    copy.hidden = false;
  };
  const guard = (): string | null => {
    if (!providerReady || providerBusy)
      return text("checking", "The diagram source is still being checked.");
    if (!isAvailable(context))
      return context.isDestroyed()
        ? text("unavailable", "The editor is no longer available.")
        : text("readOnly", "The document is busy or read-only.");
    const currentState = context.getDocumentState();
    if (
      currentState.documentGeneration !== start.documentGeneration ||
      currentState.contentRevision !== start.contentRevision ||
      (isCreate && currentState.stateRevision !== start.stateRevision)
    )
      return text("staleDocument", "The document changed while this dialog was open.");
    if (isCreate) {
      return context.creation!.anchor <= view.state.doc.length
        ? null
        : text("invalidAnchor", "The insertion point is no longer valid.");
    }
    const current = findTarget(view.state, context.recordId!);
    return current &&
      current.id === initial!.id &&
      current.sourceFingerprint === initial!.sourceFingerprint &&
      isSupportedFence(current, view.state)
      ? null
      : text("staleDiagram", "This diagram changed while the editor was open.");
  };

  apply.addEventListener("click", () => {
    if (closed) return;
    const reason = guard();
    if (reason) return failClosed(reason);
    if (draft === source) return close();
    let from: number;
    let to: number;
    let insert = draft;
    if (isCreate) {
      from = to = context.creation!.anchor;
      insert = fitBlockAtAnchor(view, from, makeFencedBlock(draft));
    } else {
      const current = findTarget(view.state, context.recordId!)!;
      if (closesFence(initial!, view, draft)) {
        status.textContent = text(
          "closingFence",
          "The draft contains a closing fence that would end this code block.",
        );
        return;
      }
      ({ from, to } = graphicalFence(current, view.state)!.bodyRange);
    }
    const before = view.state.doc.toString();
    view.dispatch({
      changes: { from, to, insert },
      annotations: [isolateHistory.of("full"), authorizeWysiwygProtectedChange.of(true)],
      userEvent: isCreate ? "input.graphical-code-create" : "input.graphical-code-editor",
    });
    if (view.state.doc.toString() === before) {
      return failClosed(
        text(
          "applyFailed",
          "The editor could not apply this change. Copy the draft before closing.",
        ),
      );
    }
    close();
  });
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  // An in-place label editor inside the diagram swallows Escape to cancel only
  // that edit. Without this the native dialog `cancel` closes the whole editor
  // and the user loses their draft context for a one-level undo.
  //
  // Only the native dialog default must be suppressed here: the event still has
  // to reach the content layer, which owns what Escape means for its own widget
  // (cancel a label edit, drop a new-node placeholder, ...).
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // "Is the user typing into something inside this dialog?" — if so the
      // dialog must not close, but the widget still decides what happens next.
      const typing = target?.closest?.(
        '[contenteditable="true"], input, textarea, select, .mw-inplace-editor',
      );
      if (!typing) return;
      // Suppress the dialog's own Escape handling without stealing the event.
      event.preventDefault();
    },
    true,
  );
  copy.addEventListener("click", async () => {
    try {
      const clipboard = document.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await clipboard.writeText(draft);
      status.textContent = text("copied", "Draft copied.");
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = draft;
      fallback.setAttribute("aria-label", text("draftToCopy", "Draft to copy"));
      dialog.append(fallback);
      fallback.select();
      status.textContent = text("copyManually", "Select and copy the draft below.");
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([hidden]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hidden);
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
    if (controls.length === 0 || activeIndex < 0) return;
    if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && activeIndex === controls.length - 1) {
      event.preventDefault();
      controls[0]?.focus();
    }
  });

  const MutationObserverConstructor = document.defaultView?.MutationObserver;
  themeObserver = MutationObserverConstructor
    ? new MutationObserverConstructor(() => mounted?.setTheme?.(context.isDark()))
    : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-theme-scheme"],
  });

  if (inspectionFailure) {
    status.textContent = inspectionFailure;
    copy.hidden = false;
    return;
  }

  try {
    mounted = await provider.mount({
      container: editor,
      source,
      isDark: context.isDark(),
      translateEditorMessage: context.translateEditorMessage,
      signal: sessionAbortController.signal,
      onChange: (next) => {
        if (!closed) {
          draft = next;
          status.textContent = "";
        }
      },
      onBusyChange: (busy) => {
        providerBusy = busy;
        apply.disabled = busy || !providerReady;
      },
      onError: (error) => {
        status.textContent = error.message;
      },
    });
    if (closed || context.isDestroyed()) {
      mounted.destroy();
      mounted = null;
      close();
      return;
    }
    providerReady = true;
    apply.disabled = providerBusy;
    mounted.setTheme?.(context.isDark());
    editor
      .querySelector<HTMLElement>("[contenteditable=true], input, textarea, button, [tabindex]")
      ?.focus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    failClosed(
      text(
        "mountFailed",
        "The diagram editor failed to start. Close this dialog and keep your document unchanged.",
      ),
    );
  }
}

function isAvailable(context: GraphicalCodeEditorContext): boolean {
  return (
    !context.isDestroyed() &&
    !context.isBusy() &&
    !context.isComposing() &&
    !context.view.state.readOnly
  );
}

function button(document: Document, label: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  return result;
}

function findTarget(state: EditorState, recordId: string): MarkdownRangeRecord | null {
  const record = state.field(markdownRangeIndexField).get(recordId);
  return record && (record.codeBlock || record.graphicalCodeBlock) ? record : null;
}

function isSupportedFence(record: MarkdownRangeRecord, state: EditorState): boolean {
  return graphicalFence(record, state) !== null;
}

function graphicalFence(
  record: MarkdownRangeRecord,
  state: EditorState,
): MarkdownGraphicalCodeBlockMetadata | null {
  const code = record.codeBlock;
  const metadata = record.graphicalCodeBlock;
  if (
    (!metadata &&
      (!code ||
        code.blockKind !== "fenced" ||
        code.blockStatus !== "closed" ||
        code.bodySegments.length !== 1)) ||
    (metadata && !metadata.isClosed)
  )
    return null;
  const document = state.doc;
  const openingMarker = metadata?.openingFenceRange ?? code?.openingFenceRange;
  const closingMarker = metadata?.closingFenceRange ?? code?.closingFenceRange;
  const bodyRange = metadata?.bodyRange ?? code?.bodyEnvelopeRange;
  if (!openingMarker || !closingMarker || !bodyRange) return null;
  const isValidRange = (range: { readonly from: number; readonly to: number }) =>
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= record.fullRange.from &&
    range.from <= range.to &&
    range.to <= record.fullRange.to &&
    range.to <= document.length;
  if (!isValidRange(openingMarker) || !isValidRange(closingMarker) || !isValidRange(bodyRange))
    return null;
  const openingLine = document.lineAt(openingMarker.from);
  const closingLine = document.lineAt(closingMarker.from);
  const openingFenceRange = metadata?.openingFenceRange ?? {
    from: openingLine.from,
    to: openingLine.to,
  };
  const closingFenceRange = metadata?.closingFenceRange ?? {
    from: closingLine.from,
    to: closingLine.to,
  };
  const openingText = document.sliceString(openingFenceRange.from, openingFenceRange.to);
  const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(openingText);
  if (
    !opening ||
    openingFenceRange.from !== openingLine.from ||
    openingFenceRange.to !== openingLine.to
  )
    return null;
  const fenceCharacter = opening[2]![0] as "`" | "~";
  const fenceLength = opening[2]!.length;
  const infoString = opening[3]!.trim();
  const closingText = document.sliceString(closingFenceRange.from, closingFenceRange.to);
  if (
    closingFenceRange.from !== closingLine.from ||
    closingFenceRange.to !== closingLine.to ||
    closingLine.from <= openingLine.to ||
    bodyRange.from !== openingLine.to + 1 ||
    bodyRange.to > closingLine.from ||
    // A custom parser must describe the entire body, including its final newline.
    (metadata && bodyRange.to !== closingLine.from) ||
    (metadata &&
      (metadata.fenceCharacter !== fenceCharacter ||
        metadata.fenceLength !== fenceLength ||
        metadata.infoString !== infoString)) ||
    (fenceCharacter === "`" && opening[3]!.includes("`")) ||
    !new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}[ \\t]*$`).test(closingText)
  )
    return null;
  return {
    bodyRange,
    openingFenceRange,
    closingFenceRange,
    fenceCharacter,
    fenceLength,
    infoString,
    isClosed: true,
  };
}

function isCurrent(
  context: GraphicalCodeEditorContext,
  start: ReturnType<GraphicalCodeEditorContext["getDocumentState"]>,
  initial: MarkdownRangeRecord,
): boolean {
  if (!isAvailable(context)) return false;
  const current = context.getDocumentState();
  const target = findTarget(context.view.state, context.recordId!);
  return (
    current.documentGeneration === start.documentGeneration &&
    current.contentRevision === start.contentRevision &&
    target?.id === initial.id &&
    target?.sourceFingerprint === initial.sourceFingerprint &&
    Boolean(target && isSupportedFence(target, context.view.state))
  );
}

function closesFence(
  record: MarkdownRangeRecord,
  view: RendererViewAdapter,
  draft: string,
): boolean {
  const fence = graphicalFence(record, view.state)!;
  return new RegExp(`^ {0,3}${fence.fenceCharacter}{${fence.fenceLength},}[ \\t]*$`, "m").test(
    draft,
  );
}

function makeFencedBlock(source: string): string {
  const body = source.replace(/\n+$/, "");
  const longestFence = Math.max(0, ...[...body.matchAll(/`+/g)].map(([fence]) => fence.length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}mermaid\n${body}\n${fence}`;
}

function diagramInsertionPoint(view: RendererViewAdapter, head: number): number | null {
  const { state } = view;
  const tree = ensureSyntaxTree(state, state.doc.length);
  if (!tree) return null;
  const block = tree.topNode.childAfter(head) ?? tree.topNode.lastChild;
  const line = state.doc.lineAt(head);
  if (!block || block.from > line.to || head > block.to) return line.to;
  // At EOF an unclosed fence still owns any appended lines. Insert before it.
  if (
    (block.name === "FencedCode" && block.getChildren("CodeMark").length < 2) ||
    (block.name === "MermaidBlock" && block.getChildren("MermaidMarker").length < 2)
  ) {
    return state.doc.lineAt(block.from).from;
  }
  return state.doc.lineAt(Math.max(block.from, block.to - 1)).to;
}

function fitBlockAtAnchor(view: RendererViewAdapter, anchor: number, block: string): string {
  const { doc } = view.state;
  const before = doc.sliceString(Math.max(0, anchor - 2), anchor);
  const after = doc.sliceString(anchor, Math.min(doc.length, anchor + 2));
  const prefix =
    anchor === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix =
    anchor === doc.length || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return prefix + block + suffix;
}
