// @vitest-environment jsdom
import { createDocumentState } from "@md-editor/core";
import { redo } from "@codemirror/commands";
import { EditorState, StateEffect } from "@codemirror/state";
import type {
  GraphicalCodeBlockEditorProvider,
  MarkdownSyntaxPlugin,
  SyntaxPluginHostPorts,
} from "@md-editor/plugin-sdk/syntax";
import { syntaxPluginHostPortsFacet } from "@md-editor/plugin-sdk/syntax";
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { authorizeWysiwygProtectedChange } from "../../src/wysiwyg/state/change-authorization.ts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DomRendererViewAdapter } from "../../src/renderer/view-adapter.ts";
import {
  createCodeMirrorRendererWithFactory,
  inspectRendererForTesting,
} from "../../src/renderer/index.ts";
import type { CodeMirrorRenderer, RendererViewAdapter } from "../../src/renderer/types.ts";
import { openGraphicalCodeEditor } from "../../src/renderer/graphical-code-editor.ts";

beforeAll(() => {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  }
});

const setups: Array<{ readonly renderer: CodeMirrorRenderer; readonly parent: HTMLDivElement }> =
  [];
function activeDialog(): HTMLDialogElement {
  return [...document.querySelectorAll<HTMLDialogElement>("dialog")].at(-1)!;
}
afterEach(() => {
  for (const item of setups.splice(0)) {
    item.renderer.destroy();
    item.parent.remove();
  }
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
});

function setup(
  plugins: readonly MarkdownSyntaxPlugin[] = [],
  markdown = "Before\n\n```mermaid\nflowchart TD\n  A[old]\n```\n\nAfter\n",
  publishEditorChanges = true,
) {
  const documentState = createDocumentState({ markdown, mode: "wysiwyg" });
  const parent = document.createElement("div");
  const focusReturn = document.createElement("button");
  focusReturn.textContent = "Open diagram editor";
  parent.append(focusReturn);
  document.body.append(parent);
  let editorView: EditorView;
  const renderer = createCodeMirrorRendererWithFactory(
    {
      parent,
      initialSnapshot: documentState.getSnapshot(),
      injectStyles: false,
      plugins,
      isDocumentBusy: () => documentState.isMutationBusy(),
      onEditorChange(change) {
        if (publishEditorChanges) documentState.applyEditorChange(change.markdown, change.origin);
      },
      onQueuedExternalEditReady() {},
      onQueuedExternalEditCancelled() {},
    },
    (input) => {
      const adapter = new DomRendererViewAdapter(input);
      editorView = adapter.editorView;
      return adapter;
    },
  );
  documentState.subscribeTransitions((event) => renderer.sync(event));
  const result = {
    markdown,
    documentState,
    focusReturn,
    parent,
    renderer,
    get view() {
      return editorView!;
    },
  };
  setups.push(result);
  return result;
}

function provider(
  onMount: (onChange: (source: string) => void) => void,
): GraphicalCodeBlockEditorProvider {
  return {
    id: "mermaid",
    diagramTypes: [
      { id: "flowchart", label: "Flowchart", initialSource: "flowchart TD" },
      { id: "sequence", label: "Sequence", initialSource: "sequenceDiagram" },
    ],
    inspect: vi.fn(async () => ({ supported: true })),
    async mount({ onChange }) {
      onMount(onChange);
      return { destroy: vi.fn() };
    },
  };
}

function graphicalMetadataPlugin(
  graphProvider: GraphicalCodeBlockEditorProvider,
  corruptMetadata?: "range-outside-document" | "body-skips-newline" | "body-truncated",
): MarkdownSyntaxPlugin {
  return {
    id: "test.graphical-code-metadata",
    name: "Graphical code metadata test",
    graphicalEditor: graphProvider,
    nodePolicies: {
      FencedCode: {
        kind: "deferred-code",
        renderPolicy: "deferred-raw",
        editPolicy: "native",
        interactionPolicy: "none",
        priority: 0,
        markerNodeNames: [],
        contentStrategy: "full",
      },
    },
    extractMetadata(node, source, children) {
      if (node.name !== "FencedCode") return;
      const markers = children.filter((child) => child.name === "CodeMark");
      const opening = markers[0];
      const closing = markers.at(-1);
      if (!opening || !closing || opening === closing) return;
      const lineRange = (position: number) => {
        const from = source.lastIndexOf("\n", position - 1) + 1;
        const newline = source.indexOf("\n", position);
        return { from, to: newline === -1 ? source.length : newline };
      };
      const openingFenceRange = lineRange(opening.from);
      const closingFenceRange = lineRange(closing.from);
      const openingLine = source.slice(openingFenceRange.from, openingFenceRange.to);
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(openingLine);
      if (!fence) return;
      const bodyRange = { from: openingFenceRange.to + 1, to: closingFenceRange.from };
      if (corruptMetadata === "range-outside-document") bodyRange.from = source.length + 1;
      if (corruptMetadata === "body-skips-newline") bodyRange.from += 1;
      if (corruptMetadata === "body-truncated") bodyRange.to -= 3;
      return {
        graphicalCodeBlock: {
          bodyRange,
          openingFenceRange,
          closingFenceRange,
          fenceCharacter: fence[1]![0] as "`" | "~",
          fenceLength: fence[1]!.length,
          infoString: fence[2]!.trim(),
          isClosed: true,
        },
      };
    },
  };
}

async function open(
  setupResult: ReturnType<typeof setup>,
  p: GraphicalCodeBlockEditorProvider,
  isBusy: () => boolean = () => setupResult.documentState.isMutationBusy(),
) {
  const record = setupResult.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
  await openGraphicalCodeEditor({
    view: setupResult.view as unknown as RendererViewAdapter,
    parent: setupResult.parent,
    provider: p,
    recordId: record.id,
    getDocumentState: () => {
      const snapshot = setupResult.documentState.getSnapshot();
      return {
        documentGeneration: snapshot.documentGeneration,
        contentRevision: snapshot.contentRevision,
        stateRevision: snapshot.stateRevision,
      };
    },
    isBusy,
    isComposing: () => setupResult.renderer.isComposing,
    isDestroyed: () => false,
    isDark: () => false,
    signal: new AbortController().signal,
  });
}

async function openThroughRenderer(
  setupResult: ReturnType<typeof setup>,
  p: GraphicalCodeBlockEditorProvider,
) {
  const record = setupResult.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
  const ports = setupResult.view.state.facet(syntaxPluginHostPortsFacet) as SyntaxPluginHostPorts;
  ports.openGraphicalCodeBlockEditor?.({ recordId: record.id, provider: p });
  await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
}

describe("graphical code editor", () => {
  it("applies a protected body-only local transaction with one undo and redo", async () => {
    const setupResult = setup();
    setupResult.focusReturn.focus();
    let onChange!: (source: string) => void;
    await open(
      setupResult,
      provider((callback) => {
        onChange = callback;
      }),
    );
    const applyButton = [...activeDialog().querySelectorAll<HTMLButtonElement>("button")].find(
      (buttonElement) => buttonElement.textContent === "Apply",
    )!;
    const cancelButton = [...activeDialog().querySelectorAll<HTMLButtonElement>("button")].find(
      (buttonElement) => buttonElement.textContent === "Cancel",
    )!;
    applyButton.focus();
    applyButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(cancelButton);
    onChange("flowchart TD\n  A[new]");
    applyButton.click();
    applyButton.click();
    expect(document.activeElement).toBe(setupResult.focusReturn);
    expect(setupResult.view.state.doc.toString()).toBe(
      setupResult.markdown.replace("A[old]", "A[new]"),
    );
    expect(setupResult.documentState.getSnapshot().contentRevision).toBe(1);
    expect(setupResult.renderer.undo()).toBe(true);
    expect(setupResult.view.state.doc.toString()).toBe(setupResult.markdown);
    expect(redo(setupResult.view)).toBe(true);
    expect(setupResult.view.state.doc.toString()).toBe(
      setupResult.markdown.replace("A[old]", "A[new]"),
    );
  });

  it("opens and edits a custom syntax record through the generic graphical fence metadata", async () => {
    let update!: (source: string) => void;
    const graphProvider = provider((onChange) => {
      update = onChange;
    });
    const host = setup([graphicalMetadataPlugin(graphProvider)]);
    const record = host.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
    expect(Object.isFrozen(record.graphicalCodeBlock)).toBe(true);
    const originalOpening = record.graphicalCodeBlock!.openingFenceRange.from;
    host.view.dispatch({ changes: { from: 0, insert: "Prefix\n" }, userEvent: "input.probe" });
    const shifted = host.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
    expect(shifted.graphicalCodeBlock!.openingFenceRange.from).toBe(originalOpening + 7);
    await openThroughRenderer(host, graphProvider);
    update("flowchart TD\n  A[custom]");
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(host.view.state.doc.toString()).toContain("A[custom]");
    expect(host.documentState.getSnapshot().contentRevision).toBe(2);
  });

  it.each(["range-outside-document", "body-skips-newline", "body-truncated"] as const)(
    "rejects malformed generic graphical fence metadata: %s",
    async (corruption) => {
      const graphProvider = provider(() => {});
      const host = setup([graphicalMetadataPlugin(graphProvider, corruption)]);
      await open(host, graphProvider);
      expect(graphProvider.inspect).not.toHaveBeenCalled();
      expect(document.querySelector("dialog")).toBeNull();
      expect(host.documentState.getSnapshot().contentRevision).toBe(0);
    },
  );

  it("leaves the document untouched when the session is a no-op or the draft closes the fence", async () => {
    const noop = setup();
    await open(
      noop,
      provider(() => {}),
    );
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(noop.documentState.getSnapshot().contentRevision).toBe(0);
    expect(noop.renderer.undo()).toBe(false);

    const invalid = setup();
    let onChange!: (source: string) => void;
    await open(
      invalid,
      provider((callback) => {
        onChange = callback;
      }),
    );
    onChange("flowchart TD\n```");
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(invalid.view.state.doc.toString()).toBe(invalid.markdown);
    expect(invalid.documentState.getSnapshot().contentRevision).toBe(0);
  });

  it("opens a create draft without writing, then inserts its complete fence only on Apply", async () => {
    let onChange!: (source: string) => void;
    const graphProvider = provider((callback) => {
      onChange = callback;
    });
    const create = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: graphProvider }]);
    expect(create.renderer.executeFormatting("insert.mermaid.flowchart")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    expect(create.documentState.getSnapshot().contentRevision).toBe(0);
    expect(create.view.state.doc.toString()).toBe(create.markdown);
    onChange("flowchart TD\n  A[created]");
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(create.view.state.doc.toString()).toContain(
      "```mermaid\nflowchart TD\n  A[created]\n```",
    );
    expect(create.documentState.getSnapshot().contentRevision).toBe(1);
    expect(create.renderer.undo()).toBe(true);
    expect(create.view.state.doc.toString()).toBe(create.markdown);
  });

  it("keeps create cancellation, read-only, stale, and IME paths write-free", async () => {
    const graphProvider = provider(() => {});
    const create = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: graphProvider }]);
    expect(create.renderer.executeFormatting("insert.mermaid.sequence")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Cancel")!
      .click();
    expect(create.view.state.doc.toString()).toBe(create.markdown);
    expect(create.documentState.getSnapshot().contentRevision).toBe(0);
    expect(create.renderer.undo()).toBe(false);

    const noopCreate = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: graphProvider }]);
    expect(noopCreate.renderer.executeFormatting("insert.mermaid.flowchart")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(noopCreate.view.state.doc.toString()).toBe(noopCreate.markdown);
    expect(noopCreate.documentState.getSnapshot().contentRevision).toBe(0);
    expect(noopCreate.renderer.undo()).toBe(false);

    const readonly = setup();
    await open(
      readonly,
      provider(() => {}),
    );
    readonly.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(readonly.view.state.doc.toString()).toBe(readonly.markdown);
    expect(readonly.documentState.getSnapshot().contentRevision).toBe(0);

    const stale = setup();
    await open(
      stale,
      provider(() => {}),
    );
    stale.view.dispatch({ changes: { from: 0, insert: "Changed " }, userEvent: "input.probe" });
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(stale.documentState.getSnapshot().contentRevision).toBe(1);
    expect(stale.view.state.doc.toString()).toBe(
      stale.markdown.replace("Before", "Changed Before"),
    );

    const composing = setup();
    await open(
      composing,
      provider(() => {}),
    );
    composing.view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(composing.documentState.getSnapshot().contentRevision).toBe(0);
    expect(composing.view.state.doc.toString()).toBe(composing.markdown);
    composing.view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  it("rejects a held core reservation and a deleted ID even when an identical block remains", async () => {
    const source =
      "```mermaid\nflowchart TD\n  A[old]\n```\n\n```mermaid\nflowchart TD\n  A[old]\n```\n";
    const duplicate = setup([], source);
    let updateDraft!: (source: string) => void;
    await open(
      duplicate,
      provider((callback) => {
        updateDraft = callback;
      }),
    );
    updateDraft("flowchart TD\n  A[draft]");
    const first = duplicate.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
    const firstRange = first.codeBlock!.sourceBlockRange;
    duplicate.view.dispatch({
      changes: { from: firstRange.from, to: firstRange.to, insert: "removed" },
      annotations: authorizeWysiwygProtectedChange.of(true),
      userEvent: "input.probe",
    });
    expect(
      duplicate.view.state.field(markdownRangeIndexField).byKind("deferred-code"),
    ).toHaveLength(1);
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(duplicate.documentState.getSnapshot().contentRevision).toBe(1);
    expect(
      activeDialog().querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__copy")
        ?.hidden,
    ).toBe(false);
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Copy draft")!
      .click();
    await vi.waitFor(() =>
      expect(activeDialog().querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "flowchart TD\n  A[draft]",
      ),
    );

    const reserved = setup();
    let changeReserved!: (source: string) => void;
    await open(
      reserved,
      provider((callback) => {
        changeReserved = callback;
      }),
    );
    changeReserved("flowchart TD\n  A[reserved]");
    const snapshot = reserved.documentState.getSnapshot();
    const lock = reserved.documentState.reserveExternalEdit({
      operationId: "graphical-editor-test-reservation",
      expectedGeneration: snapshot.documentGeneration,
      expectedContentRevision: snapshot.contentRevision,
    });
    expect(lock.status).toBe("reserved");
    expect(reserved.documentState.isMutationBusy()).toBe(true);
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(reserved.view.state.doc.toString()).toBe(reserved.markdown);
    expect(reserved.documentState.getSnapshot().contentRevision).toBe(0);
    if (lock.status === "reserved")
      reserved.documentState.releaseExternalEdit(lock.reservation, "cancelled");
  });

  it("blocks graphical Apply during a pending external edit and reconcile requirement", async () => {
    const pending = setup(
      [{ id: "mermaid", name: "Mermaid", graphicalEditor: provider(() => {}) }],
      "Before\n\n```mermaid\nflowchart TD\n  A[old]\n```\n\nAfter\n",
      false,
    );
    let updatePending!: (source: string) => void;
    await openThroughRenderer(
      pending,
      provider((callback) => {
        updatePending = callback;
      }),
    );
    updatePending("flowchart TD\n  A[draft]");
    const snapshot = pending.documentState.getSnapshot();
    expect(
      pending.renderer.applyReservedExternalEdit({
        operationId: "graphical-editor-pending-edit",
        markdown: snapshot.markdown.replace("Before", "Changed Before"),
        expectedGeneration: snapshot.documentGeneration,
        expectedContentRevision: snapshot.contentRevision,
        selection: "preserve-offset-clamped",
      }).status,
    ).toBe("applied");
    expect(inspectRendererForTesting(pending.renderer).pendingExternalEditOperationId).toBe(
      "graphical-editor-pending-edit",
    );
    const pendingMarkdown = pending.view.state.doc.toString();
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(pending.view.state.doc.toString()).toBe(pendingMarkdown);
    expect(pending.documentState.getSnapshot().contentRevision).toBe(0);

    const reconcileProvider = provider(() => {});
    const reconciling = setup([
      { id: "mermaid", name: "Mermaid", graphicalEditor: reconcileProvider },
    ]);
    let updateReconcile!: (source: string) => void;
    await openThroughRenderer(
      reconciling,
      provider((callback) => {
        updateReconcile = callback;
      }),
    );
    updateReconcile("flowchart TD\n  A[draft]");
    const current = reconciling.documentState.getSnapshot();
    expect(
      reconciling.renderer.sync({
        snapshot: { ...current, stateRevision: current.stateRevision + 2 },
        transition: { kind: "metadata", fields: ["filePath"] },
      }).status,
    ).toBe("reconcile-required");
    expect(inspectRendererForTesting(reconciling.renderer).lastSyncStatus).toBe(
      "reconcile-required",
    );
    const beforeReconcileApply = reconciling.view.state.doc.toString();
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(reconciling.view.state.doc.toString()).toBe(beforeReconcileApply);
    expect(reconciling.documentState.getSnapshot().contentRevision).toBe(0);
  });

  it("keeps revision staleness after outside edit undo and rejects reloads and moved create anchors", async () => {
    const edited = setup();
    let change!: (source: string) => void;
    await open(
      edited,
      provider((callback) => {
        change = callback;
      }),
    );
    change("flowchart TD\n  A[draft]");
    edited.view.dispatch({ changes: { from: 0, insert: "outside " }, userEvent: "input.probe" });
    expect(edited.renderer.undo()).toBe(true);
    expect(edited.view.state.doc.toString()).toBe(edited.markdown);
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(edited.documentState.getSnapshot().contentRevision).toBe(2);
    expect(
      activeDialog().querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__copy")
        ?.hidden,
    ).toBe(false);

    const reloaded = setup();
    let reloadDraft!: (source: string) => void;
    await open(
      reloaded,
      provider((callback) => {
        reloadDraft = callback;
      }),
    );
    reloadDraft("flowchart TD\n  A[reload]");
    const generationBeforeReload = reloaded.documentState.getSnapshot().documentGeneration;
    reloaded.documentState.replaceDocument(
      { markdown: reloaded.markdown, replaceIntent: "same" },
      { kind: "command", commandId: "file.reload" },
    );
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(reloaded.documentState.getSnapshot().documentGeneration).toBe(
      generationBeforeReload + 1,
    );
    expect(reloaded.documentState.getSnapshot().contentRevision).toBe(0);

    const createProvider = provider(() => {});
    const created = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: createProvider }]);
    expect(created.renderer.executeFormatting("insert.mermaid.flowchart")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    created.documentState.replaceDocument(
      { markdown: created.markdown, replaceIntent: "same" },
      { kind: "command", commandId: "file.reload" },
    );
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(created.documentState.getSnapshot().contentRevision).toBe(0);
    expect(created.view.state.doc.toString()).toBe(created.markdown);
  });

  it("waits for provider validation and destroys a late mounted provider", async () => {
    const busySetup = setup();
    let resolveMount!: (handle: { destroy: () => void }) => void;
    let setBusy!: (busy: boolean) => void;
    let update!: (source: string) => void;
    const destroy = vi.fn();
    const validating: GraphicalCodeBlockEditorProvider = {
      ...provider((onChange) => {
        update = onChange;
      }),
      async mount(input) {
        update = input.onChange;
        setBusy = input.onBusyChange!;
        setBusy(true);
        return await new Promise((resolve) => {
          resolveMount = resolve;
        });
      },
    };
    const opening = open(busySetup, validating);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    update("flowchart TD\n  A[busy]");
    expect(
      activeDialog().querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
        .disabled,
    ).toBe(true);
    setBusy(false);
    resolveMount({ destroy });
    await opening;
    activeDialog()
      .querySelector<HTMLButtonElement>(".md-editor-graphical-code-editor__apply")!
      .click();
    expect(busySetup.documentState.getSnapshot().contentRevision).toBe(1);

    let resolveLate!: (handle: { destroy: () => void }) => void;
    const lateDestroy = vi.fn();
    let lateSignal: AbortSignal | undefined;
    const slow: GraphicalCodeBlockEditorProvider = {
      ...provider(() => {}),
      async mount({ signal }) {
        lateSignal = signal;
        return await new Promise((resolve) => {
          resolveLate = resolve;
        });
      },
    };
    const late = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: slow }]);
    expect(late.renderer.executeFormatting("insert.mermaid.flowchart")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    late.renderer.destroy();
    expect(lateSignal?.aborted).toBe(true);
    resolveLate({ destroy: lateDestroy });
    await vi.waitFor(() => expect(lateDestroy).toHaveBeenCalledOnce());
    expect(lateDestroy).toHaveBeenCalledOnce();
    expect(late.documentState.getSnapshot().contentRevision).toBe(0);
  });

  it("rejects container fences before creating an editor session", async () => {
    const quoted = setup([], "> ```mermaid\n> flowchart TD\n> A[x]\n> ```\n");
    const p = provider(() => {});
    await open(quoted, p);
    expect(p.inspect).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
    expect(quoted.documentState.getSnapshot().contentRevision).toBe(0);

    const unfinished = setup([], "```mermaid\nflowchart TD\n");
    const unfinishedProvider = provider(() => {});
    await open(unfinished, unfinishedProvider);
    expect(unfinishedProvider.inspect).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("releases the modal slot after provider inspect rejects", async () => {
    const host = setup();
    const failing: GraphicalCodeBlockEditorProvider = {
      ...provider(() => {}),
      async inspect() {
        throw new Error("unsupported source");
      },
    };
    await open(host, failing);
    expect(activeDialog().querySelector('[role="status"]')?.textContent).toBe("unsupported source");
    expect(
      [...activeDialog().querySelectorAll<HTMLButtonElement>("button")].find(
        (buttonElement) => buttonElement.textContent === "Copy draft",
      )?.hidden,
    ).toBe(false);
    expect(activeDialog().querySelector<HTMLButtonElement>("button[disabled]")?.textContent).toBe(
      "Apply",
    );
    expect(host.documentState.getSnapshot().contentRevision).toBe(0);
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Cancel")!
      .click();
    await open(
      host,
      provider(() => {}),
    );
    expect(activeDialog()).toBeTruthy();
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Cancel")!
      .click();
  });

  it("closes without a dangling dialog when its abort signal is already aborted", async () => {
    const host = setup();
    const record = host.view.state.field(markdownRangeIndexField).byKind("deferred-code")[0]!;
    const controller = new AbortController();
    controller.abort();
    const mountSpy = vi.fn(async () => ({ destroy: vi.fn() }));
    await openGraphicalCodeEditor({
      view: host.view as unknown as RendererViewAdapter,
      parent: host.parent,
      provider: { ...provider(() => {}), mount: mountSpy },
      recordId: record.id,
      getDocumentState: () => {
        const snapshot = host.documentState.getSnapshot();
        return {
          documentGeneration: snapshot.documentGeneration,
          contentRevision: snapshot.contentRevision,
          stateRevision: snapshot.stateRevision,
        };
      },
      isBusy: () => host.documentState.isMutationBusy(),
      isComposing: () => host.renderer.isComposing,
      isDestroyed: () => false,
      isDark: () => false,
      signal: controller.signal,
    });
    // An already-aborted signal never dispatches to new listeners, so the dialog
    // must be closed eagerly instead of leaking its modal slot.
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
    expect(mountSpy).not.toHaveBeenCalled();
    // The slot must be free again: a fresh open still produces a dialog.
    await open(
      host,
      provider(() => {}),
    );
    expect(activeDialog()).toBeTruthy();
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Cancel")!
      .click();
  });

  it("reads and observes the desktop theme scheme while the dialog is open", async () => {
    const previousScheme = document.documentElement.dataset.themeScheme;
    document.documentElement.dataset.themeScheme = "dark";
    const setTheme = vi.fn();
    const themeProvider: GraphicalCodeBlockEditorProvider = {
      ...provider(() => {}),
      async mount({ isDark }) {
        expect(isDark).toBe(true);
        return { destroy: vi.fn(), setTheme };
      },
    };
    const host = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: themeProvider }]);
    try {
      await openThroughRenderer(host, themeProvider);
      expect(setTheme).toHaveBeenLastCalledWith(true);
      document.documentElement.dataset.themeScheme = "light";
      await vi.waitFor(() => expect(setTheme).toHaveBeenLastCalledWith(false));
    } finally {
      if (previousScheme === undefined) delete document.documentElement.dataset.themeScheme;
      else document.documentElement.dataset.themeScheme = previousScheme;
    }
  });

  it("returns focus to the editor when the launch control was removed", async () => {
    let update!: (source: string) => void;
    const graphProvider = provider((onChange) => {
      update = onChange;
    });
    const host = setup([{ id: "mermaid", name: "Mermaid", graphicalEditor: graphProvider }]);
    host.focusReturn.focus();
    expect(host.renderer.executeFormatting("insert.mermaid.flowchart")).toBe(true);
    await vi.waitFor(() => expect(activeDialog()).toBeTruthy());
    host.focusReturn.remove();
    update("flowchart TD\n  A[created]");
    [...activeDialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((buttonElement) => buttonElement.textContent === "Apply")!
      .click();
    expect(host.view.hasFocus).toBe(true);
  });
});
