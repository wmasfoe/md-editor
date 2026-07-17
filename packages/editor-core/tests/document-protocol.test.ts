import { describe, expect, it, vi } from "vitest";
import {
  createDocumentState,
  switchEditorModeSafely,
  synchronizeRendererEvent,
  type DocumentMutationResult,
  type DocumentState,
  type DocumentStateEvent,
  type ModeReceipt,
  type RendererMutationOrigin,
  type RendererSyncResult,
  type SaveOutcome,
} from "../src";

const commandOrigin = { kind: "command", commandId: "test.command" } as const;

function rendererOrigin(sequence = 1): RendererMutationOrigin {
  return { kind: "renderer", clientId: "test-client", sequence };
}

function requireApplied(
  result: DocumentMutationResult,
): Extract<DocumentMutationResult, { readonly status: "applied" }> {
  if (result.status !== "applied") {
    throw new Error(`Expected applied mutation, received ${result.status}.`);
  }
  return result;
}

function reserve(document: DocumentState, operationId = "external:1") {
  const snapshot = document.getSnapshot();
  const result = document.reserveExternalEdit({
    operationId,
    expectedGeneration: snapshot.documentGeneration,
    expectedContentRevision: snapshot.contentRevision,
  });
  if (result.status !== "reserved") {
    throw new Error(`Expected reservation, received ${result.status}.`);
  }
  return result.reservation;
}

function committed(filePath: string, withWarning = false): SaveOutcome {
  return {
    status: "succeeded",
    commit: withWarning ? "committed-with-warning" : "committed",
    filePath,
    warnings: withWarning
      ? [{ code: "asset-directory-registration-failed", message: "asset warning" }]
      : [],
  };
}

const failed: SaveOutcome = {
  status: "failed",
  commit: "not-committed",
  phase: "rename",
  errorCode: "rename-failed",
};

const cancelled: SaveOutcome = {
  status: "cancelled",
  commit: "not-committed",
  phase: "dialog",
  reason: "dialog-cancelled",
};

function indeterminate(candidatePath?: string): SaveOutcome {
  return {
    status: "indeterminate",
    commit: "unknown",
    errorCode: "ipc-timeout",
    verificationRequired: true,
    ...(candidatePath === undefined ? {} : { candidatePath }),
  };
}

describe("DocumentState S1 protocol", () => {
  it("C1 normalizes initial Markdown and baseline to LF with initial revisions", () => {
    const document = createDocumentState({
      markdown: "One\r\nTwo\rThree",
      savedMarkdown: "One\nTwo\nThree",
    });

    expect(document.getSnapshot()).toEqual({
      markdown: "One\nTwo\nThree",
      savedMarkdown: "One\nTwo\nThree",
      filePath: null,
      mode: "wysiwyg",
      isDirty: false,
      documentGeneration: 1,
      stateRevision: 0,
      contentRevision: 0,
      persistenceStatus: { kind: "verified", checkpointId: null, sequence: null },
    });
    expect(Object.isFrozen(document.getSnapshot())).toBe(true);
    expect(Object.isFrozen(document.getSnapshot().persistenceStatus)).toBe(true);
  });

  it("C2 and C19 emit one immutable renderer acknowledgement with a derived operation id", () => {
    const document = createDocumentState({ markdown: "Before" });
    const events: DocumentStateEvent[] = [];
    document.subscribeTransitions((event) => events.push(event));

    const result = requireApplied(document.applyEditorChange("After\r\n", rendererOrigin(7)));

    expect(result.snapshot).toMatchObject({
      markdown: "After\n",
      documentGeneration: 1,
      stateRevision: 1,
      contentRevision: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.transition).toEqual({
      kind: "content",
      origin: { kind: "renderer", clientId: "test-client", sequence: 7 },
      operationId: "cm:test-client:7",
      sync: "already-applied",
    });
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]?.transition)).toBe(true);
    expect(document.applyEditorChange("After\n", rendererOrigin(8))).toEqual({
      status: "noop",
      snapshot: result.snapshot,
    });
    expect(events).toHaveLength(1);
  });

  it("C3 reserves without mutation and finalizes one external renderer receipt exactly once", () => {
    const document = createDocumentState({ markdown: "Before" });
    const before = document.getSnapshot();
    const stale = document.reserveExternalEdit({
      operationId: "external:stale",
      expectedGeneration: before.documentGeneration,
      expectedContentRevision: before.contentRevision + 1,
    });
    expect(stale).toEqual({
      status: "stale",
      actualGeneration: 1,
      actualContentRevision: 0,
    });

    const reservation = reserve(document);
    expect(document.getSnapshot()).toBe(before);
    let reentrantReservationStatus: string | undefined;
    document.subscribeTransitions(() => {
      reentrantReservationStatus = document.reserveExternalEdit({
        operationId: "external:listener",
        expectedGeneration: 1,
        expectedContentRevision: 1,
      }).status;
    });

    const receipt = document.finalizeExternalEdit(reservation, {
      operationId: "external:1",
      markdown: "After\r\n",
      viewId: "view:1",
      stateEpochId: "state:1",
      transactionSequence: 1,
    });

    expect(receipt).toEqual({
      status: "finalized",
      operationId: "external:1",
      documentGeneration: 1,
      previousContentRevision: 0,
      contentRevision: 1,
      stateRevision: 1,
    });
    expect(document.getSnapshot().markdown).toBe("After\n");
    expect(reentrantReservationStatus).toBe("rejected");
    expect(() =>
      document.finalizeExternalEdit(reservation, {
        operationId: "external:1",
        markdown: "Again",
        viewId: "view:1",
        stateEpochId: "state:1",
        transactionSequence: 2,
      }),
    ).toThrow("invalid or already consumed");

    const released = reserve(document, "external:released");
    document.releaseExternalEdit(released, "renderer-noop");
    expect(document.getSnapshot().stateRevision).toBe(1);
    expect(() => document.releaseExternalEdit(released, "cancelled")).toThrow(
      "invalid or already consumed",
    );
  });

  it("C4 atomically replaces every document field and resets content revision", () => {
    const document = createDocumentState({ markdown: "Old", filePath: "/old.md" });
    document.applyEditorChange("Dirty", rendererOrigin());
    const observations: string[] = [];
    document.subscribeTransitions((event) => {
      observations.push(`transition:${event.snapshot.filePath}:${event.snapshot.markdown}`);
    });
    document.subscribeSnapshot(() => {
      const snapshot = document.getSnapshot();
      observations.push(`snapshot:${snapshot.filePath}:${snapshot.markdown}`);
    });

    const result = requireApplied(
      document.replaceDocument(
        {
          markdown: "New\r\n",
          savedMarkdown: "New\n",
          filePath: "/new.md",
          mode: "source",
        },
        commandOrigin,
      ),
    );

    expect(result.snapshot).toMatchObject({
      markdown: "New\n",
      savedMarkdown: "New\n",
      filePath: "/new.md",
      mode: "source",
      isDirty: false,
      documentGeneration: 2,
      stateRevision: 2,
      contentRevision: 0,
      persistenceStatus: { kind: "verified", checkpointId: null, sequence: null },
    });
    expect(observations).toEqual(["transition:/new.md:New\n", "snapshot:/new.md:New\n"]);
  });

  it("C5 treats identical Markdown as a real document boundary", () => {
    const document = createDocumentState({ markdown: "Same" });
    const events: DocumentStateEvent[] = [];
    document.subscribeTransitions((event) => events.push(event));

    const result = requireApplied(document.replaceDocument({ markdown: "Same" }, commandOrigin));

    expect(result.snapshot.documentGeneration).toBe(2);
    expect(result.snapshot.contentRevision).toBe(0);
    expect(events.map((event) => event.transition.kind)).toEqual(["document-replace"]);
  });

  it("C6 commits mode by CAS without changing content authority", () => {
    const document = createDocumentState({ markdown: "Draft", savedMarkdown: "Saved" });
    const before = document.getSnapshot();
    const events: DocumentStateEvent[] = [];
    document.subscribeTransitions((event) => events.push(event));

    const result = requireApplied(
      document.commitMode({
        operationId: "mode:1",
        mode: "source",
        expectedGeneration: before.documentGeneration,
        expectedStateRevision: before.stateRevision,
        origin: commandOrigin,
      }),
    );

    expect(result.snapshot).toMatchObject({
      markdown: "Draft",
      savedMarkdown: "Saved",
      mode: "source",
      isDirty: true,
      documentGeneration: 1,
      stateRevision: 1,
      contentRevision: 0,
    });
    expect(events[0]?.transition).toMatchObject({ kind: "mode", operationId: "mode:1" });
    expect(
      document.commitMode({
        operationId: "mode:2",
        mode: "source",
        expectedGeneration: 1,
        expectedStateRevision: 1,
        origin: commandOrigin,
      }).status,
    ).toBe("noop");
  });

  it("C7 and C8 settle an authoritative checkpoint atomically with its actual path", () => {
    const document = createDocumentState({ markdown: "Draft", filePath: "/old.md" });
    document.applyEditorChange("Saved\r\n", rendererOrigin());
    const checkpoint = document.beginSave({ kind: "prompt", suggestedPath: "/requested.md" });
    const events: DocumentStateEvent[] = [];
    document.subscribeTransitions((event) => events.push(event));

    const result = document.settleSave(checkpoint, committed("/actual.md"));

    expect(result).toEqual({ status: "applied", authoritativeCheckpointId: checkpoint.id });
    expect(checkpoint).toMatchObject({
      sequence: 1,
      documentGeneration: 1,
      contentRevision: 1,
      markdownLf: "Saved\n",
      destination: { kind: "prompt", suggestedPath: "/requested.md" },
    });
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.destination)).toBe(true);
    expect(document.getSnapshot()).toMatchObject({
      markdown: "Saved\n",
      savedMarkdown: "Saved\n",
      filePath: "/actual.md",
      isDirty: false,
      documentGeneration: 1,
      stateRevision: 2,
      contentRevision: 1,
      persistenceStatus: { kind: "verified", checkpointId: checkpoint.id, sequence: 1 },
    });
    expect(events[0]?.transition).toEqual({
      kind: "save-settled",
      checkpointId: checkpoint.id,
      sequence: 1,
      filePath: "/actual.md",
      fields: ["savedMarkdown", "filePath"],
      rendererDisposition: "noop",
    });
  });

  it("C9 keeps edits made during save and derives dirty only from baseline equality", () => {
    const document = createDocumentState({ markdown: "One", filePath: "/post.md" });
    document.applyEditorChange("Two", rendererOrigin(1));
    const checkpoint = document.beginSave({ kind: "current-path", path: "/post.md" });
    document.applyEditorChange("Three", rendererOrigin(2));

    expect(document.settleSave(checkpoint, committed("/post.md")).status).toBe("applied");
    expect(document.getSnapshot()).toMatchObject({
      markdown: "Three",
      savedMarkdown: "Two",
      isDirty: true,
    });

    document.applyEditorChange("Two", rendererOrigin(3));
    expect(document.getSnapshot()).toMatchObject({
      markdown: "Two",
      savedMarkdown: "Two",
      isDirty: false,
      contentRevision: 3,
    });
  });

  it("C10 rejects every old-generation settlement without touching the replacement", () => {
    const outcomes: SaveOutcome[] = [
      committed("/old.md"),
      committed("/old.md", true),
      failed,
      cancelled,
      indeterminate("/maybe.md"),
      {
        status: "superseded-before-commit",
        commit: "not-committed",
        runtimeSequence: 1,
        supersededByRuntimeSequence: 2,
      },
    ];

    for (const [index, outcome] of outcomes.entries()) {
      const document = createDocumentState({ markdown: "Old", filePath: "/old.md" });
      const checkpoint = document.beginSave({ kind: "current-path", path: "/old.md" });
      document.replaceDocument(
        { markdown: `New ${index}`, filePath: "/new.md", mode: "source" },
        commandOrigin,
      );
      const before = document.getSnapshot();

      expect(document.settleSave(checkpoint, outcome)).toEqual({ status: "stale-generation" });
      expect(document.getSnapshot()).toBe(before);
      expect(document.settleSave(checkpoint, outcome)).toEqual({ status: "duplicate" });
    }
  });

  it("C11 orders subscriptions, isolates listener errors, and rejects listener writes", () => {
    const listenerErrors: string[] = [];
    const document = createDocumentState({
      markdown: "Before",
      onListenerError: (error, context) => {
        listenerErrors.push(`${context.channel}:${String(error)}`);
      },
    });
    const calls: string[] = [];
    let reentrantResult: DocumentMutationResult | undefined;

    document.subscribeTransitions(() => {
      calls.push("transition:first");
      throw new Error("listener failed");
    });
    document.subscribeTransitions((event) => {
      calls.push(`transition:second:${event.snapshot.stateRevision}`);
      reentrantResult = document.setDocumentPath({
        filePath: "/reentrant.md",
        expectedGeneration: event.snapshot.documentGeneration,
        expectedStateRevision: event.snapshot.stateRevision,
        origin: commandOrigin,
      });
    });
    const unsubscribe = document.subscribeTransitions(() => calls.push("transition:removed"));
    unsubscribe();
    document.subscribeSnapshot(() =>
      calls.push(`snapshot:${document.getSnapshot().stateRevision}`),
    );

    const stableBefore = document.getSnapshot();
    expect(document.getSnapshot()).toBe(stableBefore);
    document.applyEditorChange("After", rendererOrigin());

    expect(calls).toEqual(["transition:first", "transition:second:1", "snapshot:1"]);
    expect(listenerErrors).toEqual(["transition:Error: listener failed"]);
    expect(reentrantResult).toEqual({ status: "rejected", reason: "listener-reentrancy" });
    expect(document.getSnapshot().filePath).toBeNull();
    expect(document.getSnapshot()).not.toBe(stableBefore);
    expect(document.getSnapshot()).toBe(document.getSnapshot());
  });

  it("C11 starts new subscriptions on the next event and honors same-delivery unsubscribe", () => {
    const document = createDocumentState({ markdown: "Before" });
    const calls: string[] = [];
    const addedTransition = () => calls.push("transition:added");
    const removedTransition = () => calls.push("transition:removed");
    const subscriptions: {
      removedTransition?: () => void;
      removedSnapshot?: () => void;
    } = {};

    document.subscribeTransitions(() => {
      calls.push("transition:first");
      document.subscribeTransitions(addedTransition);
      subscriptions.removedTransition?.();
    });
    subscriptions.removedTransition = document.subscribeTransitions(removedTransition);

    const addedSnapshot = () => calls.push("snapshot:added");
    const removedSnapshot = () => calls.push("snapshot:removed");
    document.subscribeSnapshot(() => {
      calls.push("snapshot:first");
      document.subscribeSnapshot(addedSnapshot);
      subscriptions.removedSnapshot?.();
    });
    subscriptions.removedSnapshot = document.subscribeSnapshot(removedSnapshot);

    document.applyEditorChange("After", rendererOrigin(1));
    expect(calls).toEqual(["transition:first", "snapshot:first"]);

    calls.length = 0;
    document.applyEditorChange("Again", rendererOrigin(2));
    expect(calls).toEqual([
      "transition:first",
      "transition:added",
      "snapshot:first",
      "snapshot:added",
    ]);
  });

  it("C12 applies revision and no-op rules consistently", () => {
    const document = createDocumentState({ markdown: "A\n", filePath: "/a.md" });
    const initial = document.getSnapshot();
    expect(document.applyEditorChange("A\r\n", rendererOrigin()).status).toBe("noop");
    expect(document.getSnapshot()).toBe(initial);

    document.applyEditorChange("B", rendererOrigin(2));
    expect(document.getSnapshot()).toMatchObject({
      stateRevision: 1,
      contentRevision: 1,
      isDirty: true,
    });
    const pathResult = requireApplied(
      document.setDocumentPath({
        filePath: "/b.md",
        expectedGeneration: 1,
        expectedStateRevision: 1,
        origin: commandOrigin,
      }),
    );
    expect(pathResult.snapshot).toMatchObject({
      stateRevision: 2,
      contentRevision: 1,
      isDirty: true,
    });
    const checkpoint = document.beginSave({ kind: "current-path", path: "/b.md" });
    document.settleSave(checkpoint, committed("/b.md"));
    expect(document.getSnapshot()).toMatchObject({
      stateRevision: 3,
      contentRevision: 1,
      isDirty: false,
    });
    const unchanged = document.getSnapshot();
    expect(
      document.setDocumentPath({
        filePath: "/b.md",
        expectedGeneration: 1,
        expectedStateRevision: 3,
        origin: commandOrigin,
      }).status,
    ).toBe("noop");
    expect(document.getSnapshot()).toBe(unchanged);
  });

  it("C13 changes only path metadata", () => {
    const document = createDocumentState({ markdown: "Dirty", savedMarkdown: "Saved" });
    const before = document.getSnapshot();
    const result = requireApplied(
      document.setDocumentPath({
        filePath: "/moved.md",
        expectedGeneration: before.documentGeneration,
        expectedStateRevision: before.stateRevision,
        origin: commandOrigin,
      }),
    );

    expect(result.snapshot).toMatchObject({
      markdown: "Dirty",
      savedMarkdown: "Saved",
      filePath: "/moved.md",
      isDirty: true,
      documentGeneration: before.documentGeneration,
      stateRevision: before.stateRevision + 1,
      contentRevision: before.contentRevision,
    });
    expect(result.event.transition).toEqual({ kind: "metadata", fields: ["filePath"] });
  });

  it("C14 settles overlapping saves by sequence and commit certainty", () => {
    const promoted = createDocumentState({ markdown: "A", filePath: "/a.md" });
    const lower = promoted.beginSave({ kind: "prompt", suggestedPath: "/lower.md" });
    promoted.applyEditorChange("B", rendererOrigin());
    const higher = promoted.beginSave({ kind: "prompt", suggestedPath: "/higher.md" });
    expect(promoted.settleSave(lower, committed("/lower-actual.md"))).toEqual({
      status: "deferred",
      blockedBySequence: higher.sequence,
    });
    expect(promoted.settleSave(higher, failed)).toEqual({
      status: "promoted",
      authoritativeCheckpointId: lower.id,
      triggeredByCheckpointId: higher.id,
    });
    expect(promoted.getSnapshot()).toMatchObject({
      markdown: "B",
      savedMarkdown: "A",
      filePath: "/lower-actual.md",
      isDirty: true,
    });

    const warningWins = createDocumentState({ markdown: "One" });
    const first = warningWins.beginSave({ kind: "prompt", suggestedPath: "/one.md" });
    warningWins.applyEditorChange("Two", rendererOrigin());
    const second = warningWins.beginSave({ kind: "prompt", suggestedPath: "/two.md" });
    expect(warningWins.settleSave(first, committed("/one.md")).status).toBe("deferred");
    expect(warningWins.settleSave(second, committed("/two.md", true)).status).toBe("applied");
    expect(warningWins.getSnapshot()).toMatchObject({ savedMarkdown: "Two", filePath: "/two.md" });
    expect(warningWins.settleSave(second, committed("/two.md"))).toEqual({ status: "duplicate" });

    const outOfOrder = createDocumentState({ markdown: "One" });
    const old = outOfOrder.beginSave({ kind: "prompt", suggestedPath: "/old.md" });
    outOfOrder.applyEditorChange("Two", rendererOrigin());
    const newest = outOfOrder.beginSave({ kind: "prompt", suggestedPath: "/new.md" });
    expect(outOfOrder.settleSave(newest, committed("/new.md")).status).toBe("applied");
    expect(outOfOrder.settleSave(old, committed("/old.md"))).toEqual({
      status: "superseded",
      authoritativeSequence: newest.sequence,
    });

    const multiple = createDocumentState({ markdown: "One" });
    const one = multiple.beginSave({ kind: "prompt" });
    multiple.applyEditorChange("Two", rendererOrigin(1));
    const two = multiple.beginSave({ kind: "prompt" });
    multiple.applyEditorChange("Three", rendererOrigin(2));
    const three = multiple.beginSave({ kind: "prompt" });
    expect(multiple.settleSave(one, committed("/one.md")).status).toBe("deferred");
    expect(multiple.settleSave(two, committed("/two.md")).status).toBe("deferred");
    expect(multiple.settleSave(three, cancelled)).toEqual({
      status: "promoted",
      authoritativeCheckpointId: two.id,
      triggeredByCheckpointId: three.id,
    });
    expect(multiple.getSnapshot()).toMatchObject({ savedMarkdown: "Two", filePath: "/two.md" });
  });

  it("C15 performs renderer-port-first mode CAS and synchronous rollback", () => {
    const document = createDocumentState({ markdown: "Mode" });
    const receipt: ModeReceipt = {
      operationId: "mode:success",
      clientId: "renderer:1",
      documentGeneration: 1,
      expectedStateRevision: 0,
      previousMode: "wysiwyg",
      appliedMode: "source",
      viewId: "view:1",
      stateEpochId: "state:1",
    };
    const rollbackMode = vi.fn();
    expect(
      switchEditorModeSafely(document, "source", {
        operationId: receipt.operationId,
        renderer: { applyMode: () => ({ status: "applied", receipt }), rollbackMode },
      }),
    ).toMatchObject({ ok: true, snapshot: { mode: "source", stateRevision: 1 } });
    expect(rollbackMode).not.toHaveBeenCalled();

    const rejected = createDocumentState({ markdown: "Mode" });
    expect(
      switchEditorModeSafely(rejected, "source", {
        operationId: "mode:stale",
        renderer: {
          applyMode: () => ({ status: "stale", actualGeneration: 2, actualStateRevision: 0 }),
          rollbackMode,
        },
      }),
    ).toMatchObject({ ok: false, snapshot: { mode: "wysiwyg", stateRevision: 0 } });

    const casFailure = createDocumentState({ markdown: "Mode" });
    const rollbackAfterCas = vi.fn();
    const failedReceipt: ModeReceipt = { ...receipt, operationId: "mode:cas" };
    const result = switchEditorModeSafely(casFailure, "source", {
      operationId: failedReceipt.operationId,
      renderer: {
        applyMode: () => {
          casFailure.setDocumentPath({
            filePath: "/changed-during-port.md",
            expectedGeneration: 1,
            expectedStateRevision: 0,
            origin: commandOrigin,
          });
          return { status: "applied", receipt: failedReceipt };
        },
        rollbackMode: rollbackAfterCas,
      },
    });
    expect(result).toMatchObject({ ok: false, snapshot: { mode: "wysiwyg", stateRevision: 1 } });
    expect(rollbackAfterCas).toHaveBeenCalledOnce();
    expect(rollbackAfterCas).toHaveBeenCalledWith(failedReceipt);
  });

  it("C16 exposes duplicate, gap, stale-generation, reconciliation, and sync-error outcomes", () => {
    const document = createDocumentState({ markdown: "Before" });
    const event = requireApplied(document.applyEditorChange("After", rendererOrigin())).event;

    for (const initial of [
      { status: "duplicate", transactionCount: 0 },
      { status: "stale-generation", rendererGeneration: 2, eventGeneration: 1 },
    ] satisfies RendererSyncResult[]) {
      expect(
        synchronizeRendererEvent(document, { sync: () => initial, reconcile: vi.fn() }, event),
      ).toEqual({ status: "synchronized", initial });
    }

    const gap: RendererSyncResult = {
      status: "reconcile-required",
      expectedStateRevision: 0,
      receivedStateRevision: 1,
    };
    for (const strategy of [
      "revision-only",
      "isolated-transaction",
      "document-boundary",
    ] as const) {
      const reconciliation: RendererSyncResult = { status: "reconciled", strategy };
      expect(
        synchronizeRendererEvent(
          document,
          { sync: () => gap, reconcile: () => reconciliation },
          event,
        ),
      ).toEqual({ status: "synchronized", initial: gap, reconciliation });
    }
    expect(
      synchronizeRendererEvent(document, { sync: () => gap, reconcile: () => gap }, event),
    ).toEqual({ status: "sync-error", initial: gap, reconciliation: gap });
  });

  it("C17 enforces one short reservation and typed busy results", () => {
    const document = createDocumentState({ markdown: "Before", filePath: "/before.md" });
    const checkpoint = document.beginSave({ kind: "current-path", path: "/before.md" });
    const reservation = reserve(document, "external:busy");

    expect(
      document.reserveExternalEdit({
        operationId: "external:second",
        expectedGeneration: 1,
        expectedContentRevision: 0,
      }),
    ).toEqual({ status: "busy", activeOperationId: "external:busy" });
    expect(document.applyEditorChange("Local", rendererOrigin()).status).toBe("busy");
    expect(document.replaceDocument({ markdown: "Other" }, commandOrigin).status).toBe("busy");
    expect(
      document.setDocumentPath({
        filePath: "/other.md",
        expectedGeneration: 1,
        expectedStateRevision: 0,
        origin: commandOrigin,
      }).status,
    ).toBe("busy");
    expect(document.settleSave(checkpoint, committed("/before.md"))).toEqual({
      status: "busy",
      activeOperationId: "external:busy",
    });

    document.releaseExternalEdit(reservation, "composition-deferred");
    expect(document.applyEditorChange("Local", rendererOrigin()).status).toBe("applied");
    expect(document.settleSave(checkpoint, committed("/before.md")).status).toBe(
      "settled-no-state-change",
    );
  });

  it("C18 installs a verification barrier and clears it only with a later known success", () => {
    const document = createDocumentState({ markdown: "One", filePath: "/one.md" });
    const lower = document.beginSave({ kind: "prompt", suggestedPath: "/lower.md" });
    document.applyEditorChange("Two", rendererOrigin(1));
    const unknown = document.beginSave({ kind: "prompt", suggestedPath: "/unknown.md" });
    expect(document.settleSave(lower, committed("/lower.md")).status).toBe("deferred");

    const beforeUnknown = document.getSnapshot();
    expect(document.settleSave(unknown, indeterminate("/maybe.md"))).toEqual({
      status: "verification-required",
      checkpointId: unknown.id,
    });
    expect(document.getSnapshot()).toMatchObject({
      markdown: beforeUnknown.markdown,
      savedMarkdown: beforeUnknown.savedMarkdown,
      filePath: beforeUnknown.filePath,
      isDirty: true,
      stateRevision: beforeUnknown.stateRevision + 1,
      persistenceStatus: {
        kind: "verification-required",
        checkpointId: unknown.id,
        sequence: unknown.sequence,
        candidatePath: "/maybe.md",
      },
    });

    const laterFailure = document.beginSave({ kind: "prompt", suggestedPath: "/fail.md" });
    expect(document.settleSave(laterFailure, failed)).toEqual({
      status: "settled-no-state-change",
    });
    expect(document.getSnapshot().persistenceStatus.kind).toBe("verification-required");

    const laterSuccess = document.beginSave({ kind: "prompt", suggestedPath: "/verified.md" });
    expect(document.settleSave(laterSuccess, committed("/verified.md")).status).toBe("applied");
    expect(document.getSnapshot()).toMatchObject({
      savedMarkdown: "Two",
      filePath: "/verified.md",
      isDirty: false,
      persistenceStatus: {
        kind: "verified",
        checkpointId: laterSuccess.id,
        sequence: laterSuccess.sequence,
      },
    });

    const deferredAfterBarrier = createDocumentState({ markdown: "A" });
    const uncertain = deferredAfterBarrier.beginSave({ kind: "prompt" });
    deferredAfterBarrier.settleSave(uncertain, indeterminate());
    deferredAfterBarrier.applyEditorChange("B", rendererOrigin());
    const candidate = deferredAfterBarrier.beginSave({ kind: "prompt" });
    const blocker = deferredAfterBarrier.beginSave({ kind: "prompt" });
    expect(deferredAfterBarrier.settleSave(candidate, committed("/candidate.md")).status).toBe(
      "deferred",
    );
    expect(deferredAfterBarrier.settleSave(blocker, cancelled)).toEqual({
      status: "promoted",
      authoritativeCheckpointId: candidate.id,
      triggeredByCheckpointId: blocker.id,
    });
    expect(deferredAfterBarrier.getSnapshot().persistenceStatus.kind).toBe("verified");
  });

  it("C19 preserves one external operation id through reservation, receipt, and transition", () => {
    const document = createDocumentState({ markdown: "Before" });
    const events: DocumentStateEvent[] = [];
    document.subscribeTransitions((event) => events.push(event));
    const reservation = reserve(document, "external:identity");

    const receipt = document.finalizeExternalEdit(reservation, {
      operationId: "external:identity",
      markdown: "After",
      viewId: "view:identity",
      stateEpochId: "state:identity",
      transactionSequence: 9,
    });

    expect(reservation.operationId).toBe("external:identity");
    expect(receipt.operationId).toBe("external:identity");
    expect(events[0]?.transition).toMatchObject({
      kind: "content",
      operationId: "external:identity",
    });
  });
});
