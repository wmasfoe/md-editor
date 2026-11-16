import { isolateHistory } from "@codemirror/commands";
import type {
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
    if (override) return override;
    return {
      ...createDefaultSyntaxPluginHostPorts(),
      openGraphicalCodeBlockEditor: ({ recordId, provider }) => this.openRecord(recordId, provider),
    };
  }

  executeFormatting(
    commandId: string,
    providers: readonly GraphicalCodeBlockEditorProvider[],
  ): boolean | null {
    const match = /^insert\.mermaid\.(flowchart|sequence)$/.exec(commandId);
    if (!match) return null;
    const provider = providers.find((candidate) =>
      candidate.diagramTypes.some(({ id }) => id === match[1]),
    );
    const diagram = provider?.diagramTypes.find(({ id }) => id === match[1]);
    if (!provider || !diagram || !this.#available()) return false;
    const anchor = this.#context.view().state.selection.main.head;
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
  if (activeDialogs.has(context.parent)) return;
  activeDialogs.add(context.parent);
  const start = context.getDocumentState();
  const isCreate = context.creation !== undefined;
  const initial = isCreate ? null : findTarget(view, context.recordId!);
  if (isCreate) {
    if (context.creation!.anchor < 0 || context.creation!.anchor > view.state.doc.length) {
      activeDialogs.delete(context.parent);
      return;
    }
  } else if (!initial || !isSupportedFence(initial, view)) {
    activeDialogs.delete(context.parent);
    return;
  }
  const initialFence = isCreate ? null : graphicalFence(initial!, view);
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
      const inspected = await provider.inspect(source);
      if (!isCurrent(context, start, initial!)) {
        activeDialogs.delete(context.parent);
        return;
      }
      if (!inspected.supported)
        inspectionFailure = inspected.reason ?? "This diagram source is not supported.";
    } catch (error) {
      if (!isCurrent(context, start, initial!)) {
        activeDialogs.delete(context.parent);
        return;
      }
      inspectionFailure =
        error instanceof Error ? error.message : "The diagram source could not be checked.";
    }
  } else if (!isAvailable(context)) {
    activeDialogs.delete(context.parent);
    return;
  }

  const document = context.parent.ownerDocument;
  const priorFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "md-editor-graphical-code-editor";
  const chinese = document.documentElement.lang.toLowerCase().startsWith("zh");
  const title = chinese
    ? isCreate
      ? "新建图表"
      : "编辑图表"
    : isCreate
      ? "Create diagram"
      : "Edit diagram";
  dialog.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  const editor = document.createElement("div");
  editor.className = "md-editor-graphical-code-editor__surface";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const apply = button(document, chinese ? "应用" : "Apply");
  apply.className = "md-editor-graphical-code-editor__apply";
  apply.disabled = true;
  const cancel = button(document, chinese ? "取消" : "Cancel");
  const copy = button(document, chinese ? "复制草稿" : "Copy draft");
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
  context.signal.addEventListener("abort", close, { once: true });
  const failClosed = (message: string) => {
    status.textContent = message;
    copy.hidden = false;
  };
  const guard = (): string | null => {
    if (!providerReady || providerBusy) return "The diagram source is still being checked.";
    if (!isAvailable(context))
      return context.isDestroyed()
        ? "The editor is no longer available."
        : "The document is busy or read-only.";
    const currentState = context.getDocumentState();
    if (
      currentState.documentGeneration !== start.documentGeneration ||
      currentState.contentRevision !== start.contentRevision ||
      (isCreate && currentState.stateRevision !== start.stateRevision)
    )
      return "The document changed while this dialog was open.";
    if (isCreate) {
      return context.creation!.anchor <= view.state.doc.length
        ? null
        : "The insertion point is no longer valid.";
    }
    const current = findTarget(view, context.recordId!);
    return current &&
      current.id === initial!.id &&
      current.sourceFingerprint === initial!.sourceFingerprint &&
      isSupportedFence(current, view)
      ? null
      : "This diagram changed while the editor was open.";
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
      const current = findTarget(view, context.recordId!)!;
      if (closesFence(initial!, view, draft)) {
        status.textContent = "The draft contains a closing fence that would end this code block.";
        return;
      }
      ({ from, to } = graphicalFence(current, view)!.bodyRange);
    }
    const before = view.state.doc.toString();
    view.dispatch({
      changes: { from, to, insert },
      annotations: [isolateHistory.of("full"), authorizeWysiwygProtectedChange.of(true)],
      userEvent: isCreate ? "input.graphical-code-create" : "input.graphical-code-editor",
    });
    if (view.state.doc.toString() === before) {
      return failClosed("The editor could not apply this change. Copy the draft before closing.");
    }
    close();
  });
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  copy.addEventListener("click", async () => {
    try {
      const clipboard = document.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await clipboard.writeText(draft);
      status.textContent = "Draft copied.";
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = draft;
      fallback.setAttribute("aria-label", "Draft to copy");
      dialog.append(fallback);
      fallback.select();
      status.textContent = "Select and copy the draft below.";
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
  const themeObserver = MutationObserverConstructor
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
      signal: sessionAbortController.signal,
      onChange: (next) => {
        if (!closed) draft = next;
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
      "The diagram editor failed to start. Close this dialog and keep your document unchanged.",
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

function findTarget(view: RendererViewAdapter, recordId: string): MarkdownRangeRecord | null {
  const record = view.state.field(markdownRangeIndexField).get(recordId);
  return record && (record.codeBlock || record.graphicalCodeBlock) ? record : null;
}

function isSupportedFence(record: MarkdownRangeRecord, view: RendererViewAdapter): boolean {
  return graphicalFence(record, view) !== null;
}

function graphicalFence(
  record: MarkdownRangeRecord,
  view: RendererViewAdapter,
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
  const document = view.state.doc;
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
  const target = findTarget(context.view, context.recordId!);
  return (
    current.documentGeneration === start.documentGeneration &&
    current.contentRevision === start.contentRevision &&
    target?.id === initial.id &&
    target?.sourceFingerprint === initial.sourceFingerprint &&
    Boolean(target && isSupportedFence(target, context.view))
  );
}

function closesFence(
  record: MarkdownRangeRecord,
  view: RendererViewAdapter,
  draft: string,
): boolean {
  const fence = graphicalFence(record, view)!;
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

function fitBlockAtAnchor(view: RendererViewAdapter, anchor: number, block: string): string {
  const before = view.state.doc.sliceString(Math.max(0, anchor - 1), anchor);
  const after = view.state.doc.sliceString(anchor, Math.min(view.state.doc.length, anchor + 1));
  return `${anchor === 0 || before === "\n" ? "" : "\n"}${block}${anchor === view.state.doc.length || after === "\n" ? "" : "\n"}`;
}
