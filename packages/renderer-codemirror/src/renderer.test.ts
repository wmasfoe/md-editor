import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentSnapshot,
  type DocumentState,
  type DocumentStateEvent,
  type RendererSyncResult,
} from "@md-editor/editor-core";
import type { Markdown } from "@md-editor/shared";
import { describe, expect, it } from "vitest";
import type { CodeMirrorRenderer, ExternalEditRequest, ExternalEditResult } from "./renderer.ts";
import {
  createRendererTestHarness,
  type RendererTestHarness,
  type RendererTestingProbe,
} from "./testing.ts";

interface RendererSetup {
  readonly document: DocumentState;
  readonly harness: RendererTestHarness;
  readonly changes: Array<{
    readonly markdown: Markdown;
    readonly origin: {
      readonly kind: "renderer";
      readonly clientId: string;
      readonly sequence: number;
    };
  }>;
  readonly ready: ExternalEditRequest[];
  readonly cancellations: Array<Extract<ExternalEditResult, { readonly status: "cancelled" }>>;
  readonly events: DocumentStateEvent[];
  readonly syncResults: RendererSyncResult[];
}

function createSetup(
  input: Parameters<typeof createDocumentState>[0] = {},
  options: { readonly wireTransitions?: boolean; readonly commitLocalChanges?: boolean } = {},
): RendererSetup {
  const document = createDocumentState(input);
  const changes: RendererSetup["changes"] = [];
  const ready: ExternalEditRequest[] = [];
  const cancellations: RendererSetup["cancellations"] = [];
  const events: DocumentStateEvent[] = [];
  const syncResults: RendererSyncResult[] = [];
  let renderer: CodeMirrorRenderer | null = null;

  if (options.wireTransitions !== false) {
    document.subscribeTransitions((event) => {
      events.push(event);
      if (renderer === null) {
        throw new Error("Renderer must exist before document transitions are delivered.");
      }
      syncResults.push(renderer.sync(event));
    });
  }

  const harness = createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      changes.push(change);
      if (options.commitLocalChanges === false) {
        return;
      }
      const result = document.applyEditorChange(change.markdown, change.origin);
      if (result.status !== "applied" && result.status !== "noop") {
        throw new Error(`Local editor change did not commit: ${result.status}`);
      }
    },
    onQueuedExternalEditReady(request) {
      ready.push(request);
    },
    onQueuedExternalEditCancelled(result) {
      cancellations.push(result);
    },
  });
  renderer = harness.renderer;

  return { document, harness, changes, ready, cancellations, events, syncResults };
}

function applyExternalEdit(
  setup: RendererSetup,
  markdown: Markdown,
  operationId = "external:1",
  selection: ExternalEditRequest["selection"] = "preserve-offset-clamped",
): ExternalEditResult {
  const snapshot = setup.document.getSnapshot();
  const request: ExternalEditRequest = {
    operationId,
    markdown,
    expectedGeneration: snapshot.documentGeneration,
    expectedContentRevision: snapshot.contentRevision,
    selection,
  };
  const reservation = setup.document.reserveExternalEdit(request);
  expect(reservation.status).toBe("reserved");
  if (reservation.status !== "reserved") {
    throw new Error("Expected an external edit reservation.");
  }

  const result = setup.harness.renderer.applyReservedExternalEdit(request);
  if (result.status === "applied") {
    setup.document.finalizeExternalEdit(reservation.reservation, result.receipt);
  } else if (result.status === "noop") {
    setup.document.releaseExternalEdit(reservation.reservation, "renderer-noop");
  } else if (result.status === "queued-composition") {
    setup.document.releaseExternalEdit(reservation.reservation, "composition-deferred");
  } else {
    setup.document.releaseExternalEdit(reservation.reservation, "renderer-failed");
  }
  return result;
}

function cloneSnapshot(base: DocumentSnapshot, patch: Partial<DocumentSnapshot>): DocumentSnapshot {
  const markdown = patch.markdown ?? base.markdown;
  const savedMarkdown = patch.savedMarkdown ?? base.savedMarkdown;
  return Object.freeze({
    ...base,
    ...patch,
    markdown,
    savedMarkdown,
    isDirty: markdown !== savedMarkdown,
    persistenceStatus: Object.freeze({
      ...(patch.persistenceStatus ?? base.persistenceStatus),
    }),
  });
}

function contentEvent(
  snapshot: DocumentSnapshot,
  renderer: CodeMirrorRenderer,
  sequence: number,
): DocumentStateEvent {
  return Object.freeze({
    snapshot,
    transition: Object.freeze({
      kind: "content" as const,
      origin: Object.freeze({
        kind: "renderer" as const,
        clientId: renderer.clientId,
        sequence,
      }),
      operationId: `cm:${renderer.clientId}:${sequence}`,
      sync: "already-applied" as const,
    }),
  });
}

function documentReplaceEvent(snapshot: DocumentSnapshot): DocumentStateEvent {
  return Object.freeze({
    snapshot,
    transition: Object.freeze({
      kind: "document-replace" as const,
      origin: Object.freeze({ kind: "command" as const, commandId: "file.open" }),
    }),
  });
}

function expectStableIdentity(before: RendererTestingProbe, after: RendererTestingProbe): void {
  expect(after.viewId).toBe(before.viewId);
  expect(after.stateEpochId).toBe(before.stateEpochId);
  expect(after.rootExtensionId).toBe(before.rootExtensionId);
  expect(after.viewCreationCount).toBe(1);
  expect(after.explicitStateCreationCount).toBe(before.explicitStateCreationCount);
}

describe("CodeMirror renderer lifecycle and protocol", () => {
  it("R1 creates and destroys one view exactly once", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    const initial = setup.harness.probe();

    setup.harness.probe();
    setup.harness.renderer.reconcile(setup.document.getSnapshot());
    setup.harness.renderer.setLineNumbers(false);
    setup.harness.renderer.destroy();
    setup.harness.renderer.destroy();

    const final = setup.harness.probe();
    expect(initial.viewCreationCount).toBe(1);
    expect(initial.explicitStateCreationCount).toBe(1);
    expect(final.viewCreationCount).toBe(1);
    expect(final.viewDestructionCount).toBe(1);
    expect(final.destroyed).toBe(true);
  });

  it("R2 keeps root history while reconfiguring only mode and line-number compartments", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    setup.harness.replaceAsUser("alpha beta\n");
    setup.harness.setSelection(2, 7);
    setup.harness.setScrollTop(96);
    const before = setup.harness.probe();

    const result = switchEditorModeSafely(setup.document, "source", {
      operationId: "mode:r2",
      renderer: setup.harness.renderer,
    });
    expect(result.ok).toBe(true);
    expect(setup.harness.renderer.setLineNumbers(true)).toEqual({ status: "applied" });

    const after = setup.harness.probe();
    expectStableIdentity(before, after);
    expect(after.mode).toBe("source");
    expect(after.undoDepth).toBe(before.undoDepth);
    expect(after.selectionAnchor).toBe(before.selectionAnchor);
    expect(after.selectionHead).toBe(before.selectionHead);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.lineNumbersEnabled).toBe(true);
    expect(after.modeTransactionCount).toBe(1);
    expect(after.lineNumberTransactionCount).toBe(1);
  });

  it("R3 publishes one local origin and acknowledges it without an echo transaction", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    setup.harness.replaceAsUser("alpha beta\n");

    expect(setup.changes).toHaveLength(1);
    expect(setup.changes[0]?.origin).toEqual({
      kind: "renderer",
      clientId: setup.harness.renderer.clientId,
      sequence: 1,
    });
    expect(setup.syncResults.at(-1)).toEqual({ status: "acknowledged", transactionCount: 0 });
    expect(setup.harness.probe()).toMatchObject({
      documentTransactionCount: 1,
      highestPublishedRendererSequence: 1,
      lastAcknowledgedRendererSequence: 1,
    });
  });

  it("R4 rejects future acknowledgements and never regresses on duplicates", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    setup.harness.replaceAsUser("alpha beta\n");
    const committedEvent = setup.events.at(-1);
    if (!committedEvent) {
      throw new Error("Expected the committed local event.");
    }
    const before = setup.harness.probe();

    expect(setup.harness.renderer.sync(committedEvent)).toEqual({
      status: "duplicate",
      transactionCount: 0,
    });

    const futureSnapshot = cloneSnapshot(setup.document.getSnapshot(), {
      stateRevision: setup.document.getSnapshot().stateRevision + 1,
      contentRevision: setup.document.getSnapshot().contentRevision + 1,
    });
    expect(
      setup.harness.renderer.sync(contentEvent(futureSnapshot, setup.harness.renderer, 99)),
    ).toEqual({
      status: "reconcile-required",
      expectedStateRevision: before.stateRevision + 1,
      receivedStateRevision: futureSnapshot.stateRevision,
    });
    expect(setup.harness.probe().documentTransactionCount).toBe(before.documentTransactionCount);
  });

  it("R5 applies one reserved external transaction with clamped selection and no callback", () => {
    const setup = createSetup({ markdown: "abcdef\n" });
    setup.harness.setSelection(5, 2);
    const result = applyExternalEdit(setup, "xyz\n", "external:r5");

    expect(result.status).toBe("applied");
    expect(setup.changes).toHaveLength(0);
    expect(setup.syncResults.at(-1)).toEqual({ status: "acknowledged", transactionCount: 0 });
    expect(setup.harness.probe()).toMatchObject({
      markdown: "xyz\n",
      selectionAnchor: 4,
      selectionHead: 2,
      externalEditTransactionCount: 1,
      documentTransactionCount: 1,
      undoDepth: 1,
    });
  });

  it("R6 isolates an external whole-document edit between adjacent user undo steps", () => {
    const setup = createSetup({ markdown: "A\n" });
    setup.harness.replaceAsUser("B\n");
    expect(applyExternalEdit(setup, "C\n", "external:r6").status).toBe("applied");
    setup.harness.replaceAsUser("D\n");
    expect(setup.harness.probe().undoDepth).toBe(3);

    expect(setup.harness.undo()).toBe(true);
    expect(setup.harness.probe().markdown).toBe("C\n");
    expect(setup.harness.undo()).toBe(true);
    expect(setup.harness.probe().markdown).toBe("B\n");
    expect(setup.harness.redo()).toBe(true);
    expect(setup.harness.probe().markdown).toBe("C\n");
  });

  it("R7 treats a valid same-text external request as a protocol no-op", () => {
    const setup = createSetup({ markdown: "same\n" });
    const before = setup.harness.probe();
    expect(applyExternalEdit(setup, "same\r\n", "external:r7")).toEqual({ status: "noop" });
    expect(setup.harness.probe()).toMatchObject({
      markdown: "same\n",
      documentTransactionCount: before.documentTransactionCount,
      undoDepth: before.undoDepth,
    });
  });

  it("R8 replaces a document generation with one fresh state on the same view", () => {
    const setup = createSetup({ markdown: "old\n" });
    setup.harness.replaceAsUser("old changed\n");
    setup.harness.setSelection(4, 1);
    setup.harness.setScrollTop(240);
    const before = setup.harness.probe();

    const result = setup.document.replaceDocument(
      { markdown: "new\n", savedMarkdown: "new\n", filePath: "/new.md", mode: "source" },
      { kind: "command", commandId: "file.open" },
    );
    expect(result.status).toBe("applied");

    const after = setup.harness.probe();
    expect(after.viewId).toBe(before.viewId);
    expect(after.stateEpochId).not.toBe(before.stateEpochId);
    expect(after.stateReplacementCount).toBe(1);
    expect(after.explicitStateCreationCount).toBe(2);
    expect(after.undoDepth).toBe(0);
    expect(after.redoDepth).toBe(0);
    expect(after.selectionAnchor).toBe(0);
    expect(after.selectionHead).toBe(0);
    expect(after.scrollTop).toBe(0);
    expect(after.mode).toBe("source");
    expect(setup.changes).toHaveLength(1);
  });

  it("R9 rejects old generations and accepts a skipped authoritative boundary", () => {
    const setup = createSetup(
      { markdown: "one\n" },
      { wireTransitions: false, commitLocalChanges: false },
    );
    const initial = setup.document.getSnapshot();
    const oldSnapshot = cloneSnapshot(initial, { documentGeneration: 0 });
    expect(setup.harness.renderer.sync(documentReplaceEvent(oldSnapshot))).toEqual({
      status: "stale-generation",
      rendererGeneration: 1,
      eventGeneration: 0,
    });

    setup.harness.startComposition();
    expect(applyExternalEdit(setup, "queued\n", "external:r9").status).toBe("queued-composition");
    const skipped = cloneSnapshot(initial, {
      markdown: "three\n",
      savedMarkdown: "three\n",
      mode: "source",
      documentGeneration: 3,
      stateRevision: 1,
      contentRevision: 0,
    });
    expect(setup.harness.renderer.sync(documentReplaceEvent(skipped))).toEqual({
      status: "applied",
      transactionCount: 1,
    });
    expect(setup.cancellations).toEqual([{ status: "cancelled", reason: "document-replaced" }]);
    expect(setup.harness.probe()).toMatchObject({
      documentGeneration: 3,
      markdown: "three\n",
      queuedExternalEditOperationId: null,
    });
  });

  it("R10 switches mode atomically without changing document-owned view state", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    setup.harness.replaceAsUser("alpha beta\n");
    setup.harness.setSelection(3, 8);
    setup.harness.setScrollTop(180);
    const before = setup.harness.probe();
    const changeCount = setup.changes.length;

    expect(
      switchEditorModeSafely(setup.document, "source", {
        operationId: "mode:r10",
        renderer: setup.harness.renderer,
      }).ok,
    ).toBe(true);
    const after = setup.harness.probe();

    expectStableIdentity(before, after);
    expect(after.markdown).toBe(before.markdown);
    expect(after.selectionAnchor).toBe(before.selectionAnchor);
    expect(after.selectionHead).toBe(before.selectionHead);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.undoDepth).toBe(before.undoDepth);
    expect(after.redoDepth).toBe(before.redoDepth);
    expect(after.mode).toBe("source");
    expect(after.modeTransactionCount).toBe(before.modeTransactionCount + 1);
    expect(setup.changes).toHaveLength(changeCount);
    expect(setup.syncResults.at(-1)).toEqual({ status: "acknowledged", transactionCount: 0 });
  });

  it("R11 survives 50 mode switches and line-number toggles without state replacement", () => {
    const setup = createSetup({ markdown: "alpha\n" });
    setup.harness.replaceAsUser("alpha beta\n");
    setup.harness.setSelection(4, 7);
    const before = setup.harness.probe();

    for (let index = 0; index < 50; index += 1) {
      const mode = index % 2 === 0 ? "source" : "wysiwyg";
      const result = switchEditorModeSafely(setup.document, mode, {
        operationId: `mode:r11:${index}`,
        renderer: setup.harness.renderer,
      });
      expect(result.ok).toBe(true);
    }
    expect(setup.harness.renderer.setLineNumbers(true)).toEqual({ status: "applied" });
    expect(setup.harness.renderer.setLineNumbers(false)).toEqual({ status: "applied" });

    const after = setup.harness.probe();
    expectStableIdentity(before, after);
    expect(after.markdown).toBe(before.markdown);
    expect(after.selectionAnchor).toBe(before.selectionAnchor);
    expect(after.selectionHead).toBe(before.selectionHead);
    expect(after.undoDepth).toBe(before.undoDepth);
    expect(after.stateRevision).toBe(before.stateRevision + 50);
    expect(after.modeTransactionCount).toBe(50);
    expect(after.lineNumberTransactionCount).toBe(2);
    expect(after.pendingModeOperationId).toBeNull();
  });

  it("R12 acknowledges metadata and persistence events without CM transactions", () => {
    const setup = createSetup({ markdown: "alpha\n", savedMarkdown: "older\n" });
    const before = setup.harness.probe();

    const pathResult = setup.document.setDocumentPath({
      filePath: "/alpha.md",
      expectedGeneration: setup.document.getSnapshot().documentGeneration,
      expectedStateRevision: setup.document.getSnapshot().stateRevision,
      origin: { kind: "command", commandId: "file.rename" },
    });
    expect(pathResult.status).toBe("applied");

    const saved = setup.document.beginSave({ kind: "current-path", path: "/alpha.md" });
    expect(
      setup.document.settleSave(saved, {
        status: "succeeded",
        commit: "committed",
        filePath: "/alpha.md",
        warnings: [],
      }).status,
    ).toBe("applied");

    setup.harness.replaceAsUser("alpha changed\n");
    const uncertain = setup.document.beginSave({ kind: "current-path", path: "/alpha.md" });
    expect(
      setup.document.settleSave(uncertain, {
        status: "indeterminate",
        commit: "unknown",
        candidatePath: "/alpha.md",
        errorCode: "TIMEOUT",
        verificationRequired: true,
      }).status,
    ).toBe("verification-required");

    expect(setup.syncResults.filter((result) => result.status === "acknowledged")).toHaveLength(4);
    expect(setup.harness.probe()).toMatchObject({
      documentTransactionCount: before.documentTransactionCount + 1,
      persistenceStatus: "verification-required",
    });
  });

  it("R13 keeps one IME request, lets local composition win, and applies unchanged work once", () => {
    const unchanged = createSetup({ markdown: "alpha\n" });
    unchanged.harness.startComposition();
    expect(applyExternalEdit(unchanged, "first\n", "ime:first").status).toBe("queued-composition");
    expect(applyExternalEdit(unchanged, "second\n", "ime:second").status).toBe(
      "queued-composition",
    );
    expect(unchanged.cancellations).toEqual([{ status: "cancelled", reason: "superseded" }]);
    unchanged.harness.endComposition();
    expect(unchanged.ready.map((request) => request.operationId)).toEqual(["ime:second"]);
    expect(applyExternalEdit(unchanged, "second\n", "ime:second").status).toBe("applied");
    expect(unchanged.harness.probe()).toMatchObject({
      markdown: "second\n",
      externalEditTransactionCount: 1,
      undoDepth: 1,
    });

    const changed = createSetup({ markdown: "alpha\n" });
    changed.harness.startComposition();
    const request: ExternalEditRequest = {
      operationId: "ime:stale",
      markdown: "external\n",
      expectedGeneration: 1,
      expectedContentRevision: 0,
      selection: "preserve-offset-clamped",
    };
    const reservation = changed.document.reserveExternalEdit(request);
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") {
      throw new Error("Expected the IME reservation.");
    }
    expect(changed.harness.renderer.applyReservedExternalEdit(request).status).toBe(
      "queued-composition",
    );
    changed.document.releaseExternalEdit(reservation.reservation, "composition-deferred");
    changed.harness.replaceAsUser("用户输入\n");
    changed.harness.endComposition();
    expect(
      changed.document.reserveExternalEdit(changed.ready[0] as ExternalEditRequest),
    ).toMatchObject({
      status: "stale",
      actualGeneration: 1,
      actualContentRevision: 1,
    });
    expect(changed.harness.probe().markdown).toBe("用户输入\n");
  });

  it("R14 cancels queued composition work on boundary replacement and destruction", () => {
    const replaced = createSetup({ markdown: "alpha\n" });
    replaced.harness.startComposition();
    expect(applyExternalEdit(replaced, "queued\n", "ime:boundary").status).toBe(
      "queued-composition",
    );
    replaced.document.replaceDocument(
      { markdown: "new document\n" },
      { kind: "command", commandId: "file.open" },
    );
    replaced.harness.endComposition();
    expect(replaced.cancellations).toEqual([{ status: "cancelled", reason: "document-replaced" }]);
    expect(replaced.ready).toHaveLength(0);

    const destroyed = createSetup({ markdown: "alpha\n" });
    destroyed.harness.startComposition();
    expect(applyExternalEdit(destroyed, "queued\n", "ime:destroy").status).toBe(
      "queued-composition",
    );
    destroyed.harness.renderer.destroy();
    destroyed.harness.endComposition();
    expect(destroyed.cancellations).toEqual([{ status: "cancelled", reason: "destroyed" }]);
    expect(destroyed.ready).toHaveLength(0);
  });

  it("R15 normalizes initial, local, and external Markdown to LF", () => {
    const setup = createSetup({ markdown: "one\r\ntwo\rthree\r\n" });
    expect(setup.harness.probe().markdown).toBe("one\ntwo\nthree\n");
    setup.harness.replaceAsUser("local\rchange\r\n");
    expect(setup.changes.at(-1)?.markdown).toBe("local\nchange\n");
    expect(applyExternalEdit(setup, "external\r\nchange\r", "external:r15").status).toBe("applied");
    expect(setup.harness.probe().markdown).toBe("external\nchange\n");
    expect(setup.harness.probe().markdown).not.toContain("\r");
  });

  it("R16 exposes every sync and reconciliation result without implicit state reads", () => {
    const setup = createSetup(
      { markdown: "alpha\n" },
      { wireTransitions: false, commitLocalChanges: false },
    );
    const base = setup.document.getSnapshot();

    expect(
      setup.harness.renderer.sync(
        Object.freeze({
          snapshot: base,
          transition: Object.freeze({ kind: "metadata" as const, fields: ["filePath"] as const }),
        }),
      ),
    ).toEqual({ status: "duplicate", transactionCount: 0 });

    const gap = cloneSnapshot(base, { stateRevision: 2 });
    expect(
      setup.harness.renderer.sync(
        Object.freeze({
          snapshot: gap,
          transition: Object.freeze({ kind: "metadata" as const, fields: ["filePath"] as const }),
        }),
      ),
    ).toEqual({
      status: "reconcile-required",
      expectedStateRevision: 1,
      receivedStateRevision: 2,
    });
    expect(setup.harness.renderer.reconcile(gap)).toEqual({
      status: "reconciled",
      strategy: "revision-only",
    });

    const divergent = cloneSnapshot(gap, {
      markdown: "authoritative\n",
      stateRevision: 3,
      contentRevision: 1,
    });
    expect(setup.harness.renderer.reconcile(divergent)).toEqual({
      status: "reconciled",
      strategy: "isolated-transaction",
    });
    expect(setup.harness.probe()).toMatchObject({
      markdown: "authoritative\n",
      reconciliationTransactionCount: 1,
      stateReplacementCount: 0,
    });

    const newer = cloneSnapshot(divergent, {
      markdown: "next document\n",
      savedMarkdown: "next document\n",
      documentGeneration: 2,
      stateRevision: 4,
      contentRevision: 0,
    });
    expect(setup.harness.renderer.reconcile(newer)).toEqual({
      status: "reconciled",
      strategy: "document-boundary",
    });
    expect(setup.harness.probe().stateReplacementCount).toBe(1);
    expect(setup.harness.renderer.reconcile(divergent)).toEqual({
      status: "stale-generation",
      rendererGeneration: 2,
      eventGeneration: 1,
    });
  });

  it("R17 explicitly resets boundary selection and scroll after setState", () => {
    const setup = createSetup({ markdown: "line 1\nline 2\nline 3\n" });
    setup.harness.setSelection(10, 15);
    setup.harness.setScrollTop(512);
    const before = setup.harness.probe();

    setup.document.replaceDocument(
      { markdown: "replacement\n", mode: "wysiwyg" },
      { kind: "command", commandId: "file.open" },
    );
    const after = setup.harness.probe();

    expect(after.viewId).toBe(before.viewId);
    expect(after.stateReplacementCount).toBe(before.stateReplacementCount + 1);
    expect(after.selectionAnchor).toBe(0);
    expect(after.selectionHead).toBe(0);
    expect(after.scrollTop).toBe(0);
  });

  it("R18 restores focus-owned scroll after a hidden host is revealed", () => {
    const setup = createSetup({ markdown: "line 1\nline 2\nline 3\n" });
    setup.harness.focus();
    setup.harness.setScrollTop(320);
    const before = setup.harness.probe();

    setup.harness.renderer.setHostVisibility(true);
    setup.harness.setScrollTop(640);
    setup.harness.renderer.setHostVisibility(false);

    const after = setup.harness.probe();
    expectStableIdentity(before, after);
    expect(after.focused).toBe(true);
    expect(after.scrollTop).toBe(320);
    expect(after.measureRequestCount).toBe(before.measureRequestCount + 1);

    setup.harness.renderer.setHostVisibility(false);
    expect(setup.harness.probe().measureRequestCount).toBe(after.measureRequestCount);
  });
});

describe("CodeMirror renderer failure recovery", () => {
  it("rolls a mode transaction back only with its exact receipt", () => {
    const setup = createSetup(
      { markdown: "alpha\n" },
      { wireTransitions: false, commitLocalChanges: false },
    );
    const snapshot = setup.document.getSnapshot();
    const applied = setup.harness.renderer.applyMode({
      operationId: "mode:rollback",
      mode: "source",
      expectedGeneration: snapshot.documentGeneration,
      expectedStateRevision: snapshot.stateRevision,
    });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") {
      throw new Error("Expected the mode receipt.");
    }
    setup.harness.renderer.rollbackMode(applied.receipt);
    expect(setup.harness.probe()).toMatchObject({
      mode: "wysiwyg",
      modeTransactionCount: 2,
      pendingModeOperationId: null,
    });
    expect(() => setup.harness.renderer.rollbackMode(applied.receipt)).toThrow(
      "Mode rollback receipt is stale",
    );
  });
});
