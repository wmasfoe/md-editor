import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/editor-core";
import {
  createFileSaveScheduler,
  type FileSaveJob,
  type NativeFileSaveJob,
  type NativeSaveAdapter,
} from "@md-editor/file-system";

describe("save persistence and document settlement integration", () => {
  it("keeps same-path bytes, authoritative baseline, and path on the higher warned commit", async () => {
    const bytes = new Map<string, string>();
    const document = createDocumentState({
      markdown: "A\n",
      savedMarkdown: "initial\n",
      filePath: "/docs/post.md",
    });
    const scheduler = createFileSaveScheduler(memoryAdapter(bytes), registration());
    const checkpointA = document.beginSave({ kind: "current-path", path: "/docs/post.md" });
    const saveA = scheduler.enqueueSaveJob(jobFrom(checkpointA));
    document.applyEditorChange("B\n", {
      kind: "renderer",
      clientId: "save-settlement-integration",
      sequence: 1,
    });
    const checkpointB = document.beginSave({ kind: "current-path", path: "/docs/post.md" });
    const saveB = scheduler.enqueueSaveJob(jobFrom(checkpointB));

    const outcomeA = await saveA;
    const outcomeB = await saveB;
    expect(document.settleSave(checkpointA, outcomeA)).toMatchObject({ status: "deferred" });
    expect(document.settleSave(checkpointB, outcomeB)).toMatchObject({ status: "applied" });

    const snapshot = document.getSnapshot();
    expect(bytes.get("/docs/post.md")).toBe("B\n");
    expect(snapshot).toMatchObject({
      markdown: "B\n",
      savedMarkdown: "B\n",
      filePath: "/docs/post.md",
      isDirty: false,
      persistenceStatus: { kind: "verified", sequence: checkpointB.sequence },
    });
    expect(outcomeB).toMatchObject({ status: "succeeded", commit: "committed-with-warning" });
  });

  it("promotes a lower actual Save As path when the higher request fails before rename", async () => {
    const bytes = new Map<string, string>();
    const document = createDocumentState({ markdown: "A\n", savedMarkdown: "initial\n" });
    const scheduler = createFileSaveScheduler(
      memoryAdapter(bytes, { failRuntimeSequence: 2 }),
      registration(),
    );
    const checkpointA = document.beginSave({
      kind: "prompt",
      suggestedPath: "/suggested/a.md",
    });
    const saveA = scheduler.enqueueSaveJob(jobFrom(checkpointA));
    document.applyEditorChange("B\n", {
      kind: "renderer",
      clientId: "save-settlement-integration",
      sequence: 1,
    });
    const checkpointB = document.beginSave({
      kind: "prompt",
      suggestedPath: "/suggested/b.md",
    });
    const saveB = scheduler.enqueueSaveJob(jobFrom(checkpointB));

    const outcomeA = await saveA;
    const outcomeB = await saveB;
    expect(document.settleSave(checkpointA, outcomeA)).toMatchObject({ status: "deferred" });
    expect(document.settleSave(checkpointB, outcomeB)).toMatchObject({
      status: "promoted",
      authoritativeCheckpointId: checkpointA.id,
    });

    expect([...bytes.entries()]).toEqual([["/actual/a.md", "A\n"]]);
    expect(document.getSnapshot()).toMatchObject({
      markdown: "B\n",
      savedMarkdown: "A\n",
      filePath: "/actual/a.md",
      isDirty: true,
      persistenceStatus: { kind: "verified", sequence: checkpointA.sequence },
    });
  });
});

function registration() {
  return { epoch: 1, id: 1, sequenceSeed: 0 } as const;
}

function jobFrom(checkpoint: {
  readonly id: string;
  readonly sequence: number;
  readonly documentGeneration: number;
  readonly markdownLf: string;
  readonly destination: FileSaveJob["destination"];
}): FileSaveJob {
  return {
    jobId: checkpoint.id,
    checkpointSequence: checkpoint.sequence,
    documentGeneration: checkpoint.documentGeneration,
    markdownLf: checkpoint.markdownLf,
    destination: checkpoint.destination,
  };
}

function memoryAdapter(
  bytes: Map<string, string>,
  options: { readonly failRuntimeSequence?: number } = {},
): NativeSaveAdapter {
  return {
    async saveMarkdownJob(job: NativeFileSaveJob) {
      const runtimeSequence = job.orderingToken.runtimeSequence;
      if (runtimeSequence === options.failRuntimeSequence) {
        return {
          status: "not-committed",
          disposition: "failed",
          runtimeSequence,
          phase: "rename",
          errorCode: "rename-failed",
        };
      }

      const filePath =
        job.destination.kind === "current-path"
          ? job.destination.path
          : runtimeSequence === 1
            ? "/actual/a.md"
            : "/actual/b.md";
      bytes.set(filePath, job.markdownLf);
      return {
        status: "committed",
        runtimeSequence,
        filePath,
        warnings:
          runtimeSequence === 2
            ? [
                {
                  code: "asset-directory-registration-failed",
                  message: "scope failed after commit",
                },
              ]
            : [],
      };
    },
  };
}
