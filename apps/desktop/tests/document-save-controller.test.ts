import { createDocumentState, type SaveOutcome } from "@md-editor/editor-core";
import type { FileSaveJob } from "@md-editor/file-system";
import { describe, expect, it, vi } from "vitest";
import {
  executeDocumentSave,
  getSaveFeedback,
  isDiscardProtectionRequired,
} from "../src/app/controller/document-save";

describe("desktop document save orchestration", () => {
  it("enqueues synchronously after beginSave and settles the exact checkpoint once", async () => {
    const document = createDocumentState({
      markdown: "next\r\n",
      savedMarkdown: "before\n",
      filePath: "/doc.md",
    });
    const settle = vi.spyOn(document, "settleSave");
    let resolveOutcome!: (outcome: SaveOutcome) => void;
    const jobs: FileSaveJob[] = [];
    const fileService = {
      enqueueSaveJob(job: FileSaveJob) {
        jobs.push(job);
        return new Promise<SaveOutcome>((resolve) => {
          resolveOutcome = resolve;
        });
      },
    };

    const pending = executeDocumentSave(document, fileService, false);
    expect(jobs).toEqual([
      expect.objectContaining({
        checkpointSequence: 1,
        markdownLf: "next\n",
        destination: { kind: "current-path", path: "/doc.md" },
      }),
    ]);
    expect(settle).not.toHaveBeenCalled();

    resolveOutcome(committed("/doc.md"));
    const execution = await pending;
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(execution.checkpoint, execution.outcome);
    expect(document.getSnapshot()).toMatchObject({
      markdown: "next\n",
      savedMarkdown: "next\n",
      isDirty: false,
      filePath: "/doc.md",
    });
  });

  it("preserves checkpoint order and promotes a lower success after a higher failure", async () => {
    const document = createDocumentState({
      markdown: "A\n",
      savedMarkdown: "before\n",
      filePath: "/doc.md",
    });
    const jobs: FileSaveJob[] = [];
    const resolvers: Array<(outcome: SaveOutcome) => void> = [];
    const fileService = {
      enqueueSaveJob(job: FileSaveJob) {
        jobs.push(job);
        return new Promise<SaveOutcome>((resolve) => resolvers.push(resolve));
      },
    };

    const lower = executeDocumentSave(document, fileService, false);
    document.applyEditorChange("B\n", {
      kind: "renderer",
      clientId: "document-save-controller-test",
      sequence: 1,
    });
    const higher = executeDocumentSave(document, fileService, true);
    expect(jobs.map((job) => job.checkpointSequence)).toEqual([1, 2]);
    expect(jobs[1]?.destination).toEqual({ kind: "prompt", suggestedPath: "/doc.md" });

    resolvers[0]!(committed("/doc.md"));
    expect((await lower).settlement).toEqual({ status: "deferred", blockedBySequence: 2 });
    resolvers[1]!({
      status: "failed",
      commit: "not-committed",
      phase: "rename",
      errorCode: "rename-failed",
    });
    expect((await higher).settlement).toMatchObject({ status: "promoted" });
    expect(document.getSnapshot()).toMatchObject({
      markdown: "B\n",
      savedMarkdown: "A\n",
      isDirty: true,
      filePath: "/doc.md",
    });
  });

  it("keeps indeterminate saves protected even when Markdown equals the baseline", async () => {
    const document = createDocumentState({
      markdown: "same\n",
      savedMarkdown: "same\n",
      filePath: "/doc.md",
    });
    const execution = await executeDocumentSave(
      document,
      {
        enqueueSaveJob: async () => ({
          status: "indeterminate",
          commit: "unknown",
          candidatePath: "/doc.md",
          errorCode: "transport-lost",
          verificationRequired: true,
        }),
      },
      false,
    );

    expect(execution.settlement.status).toBe("verification-required");
    expect(document.getSnapshot().isDirty).toBe(false);
    expect(isDiscardProtectionRequired(document.getSnapshot())).toBe(true);
    expect(getSaveFeedback(execution.outcome, execution.settlement)).toContain("无法确认");
  });

  it("classifies success, warning, failure, and cancellation feedback", () => {
    const applied = { status: "applied", authoritativeCheckpointId: "save:1" } as const;
    expect(getSaveFeedback(committed("/doc.md"), applied)).toBe("已保存。");
    expect(
      getSaveFeedback(
        {
          status: "succeeded",
          commit: "committed-with-warning",
          filePath: "/doc.md",
          warnings: [
            {
              code: "asset-directory-registration-failed",
              message: "assets scope failed",
            },
          ],
        },
        applied,
      ),
    ).toContain("附加操作警告：assets scope failed");
    expect(
      getSaveFeedback(
        {
          status: "failed",
          commit: "not-committed",
          phase: "temp-write",
          errorCode: "disk-full",
        },
        { status: "settled-no-state-change" },
      ),
    ).toBe("保存失败：disk-full");
    expect(
      getSaveFeedback(
        {
          status: "cancelled",
          commit: "not-committed",
          phase: "dialog",
          reason: "dialog-cancelled",
        },
        { status: "settled-no-state-change" },
      ),
    ).toBeNull();
  });
});

function committed(filePath: string): SaveOutcome {
  return {
    status: "succeeded",
    commit: "committed",
    filePath,
    warnings: [],
  };
}
