import { describe, expect, it, vi } from "vitest";
import {
  FileSaveInvariantError,
  createFileSaveScheduler,
  type FileSaveJob,
  type FileSaveWarning,
  type NativeFileSaveJob,
  type NativeSaveAdapter,
} from "../src";

describe("FileService save scheduler", () => {
  it("F1: runs one shared FIFO and allocates one epoch sequence across consumers", async () => {
    const releases: Array<() => void> = [];
    const invokedSequences: number[] = [];
    let activeJobs = 0;
    let maxCriticalJobs = 0;
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => {
        invokedSequences.push(job.orderingToken.runtimeSequence);
        activeJobs += 1;
        maxCriticalJobs = Math.max(maxCriticalJobs, activeJobs);
        await new Promise<void>((resolve) => releases.push(resolve));
        activeJobs -= 1;
        return committed(job, `/docs/${job.jobId}.md`);
      }),
      registration(),
    );

    const consumerA = (sequence: number) => scheduler.enqueueSaveJob(saveJob(sequence));
    const consumerB = (sequence: number) => scheduler.enqueueSaveJob(saveJob(sequence));
    const first = consumerA(1);
    const second = consumerB(2);
    const third = consumerA(3);

    await nextMicrotask();
    expect(invokedSequences).toEqual([1]);
    releases.shift()?.();
    await first;
    await nextMicrotask();
    expect(invokedSequences).toEqual([1, 2]);
    releases.shift()?.();
    await second;
    await nextMicrotask();
    expect(invokedSequences).toEqual([1, 2, 3]);
    releases.shift()?.();
    await third;

    expect(maxCriticalJobs).toBe(1);
  });

  it("F2: resolves every native outcome and advances after throws or invalid payloads", async () => {
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => {
        switch (job.orderingToken.runtimeSequence) {
          case 1:
            return committed(job, "/docs/one.md");
          case 2:
            return committed(job, "/docs/two.md", [assetWarning()]);
          case 3:
            return notCommitted(job, "failed", "temp-write", "disk-full");
          case 4:
            return notCommitted(job, "cancelled", "dialog");
          case 5:
            throw new Error("IPC disconnected");
          default:
            return { unexpected: true };
        }
      }),
      registration(),
    );

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, index) => scheduler.enqueueSaveJob(saveJob(index + 1))),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "succeeded",
      "succeeded",
      "failed",
      "cancelled",
      "indeterminate",
      "indeterminate",
    ]);
    expect(outcomes[1]).toMatchObject({ commit: "committed-with-warning" });
    expect(outcomes[4]).toMatchObject({
      commit: "unknown",
      errorCode: "native-save-transport-error",
      verificationRequired: true,
    });
    expect(outcomes[5]).toMatchObject({ errorCode: "native-save-invalid-payload" });
  });

  it("F3: preserves increasing same-path bytes and never claims an unknown result", async () => {
    const bytes = new Map<string, string>();
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => {
        const path = "/docs/post.md";
        if (job.checkpointSequence === 3) {
          return notCommitted(job, "failed", "rename", "rename-failed");
        }
        bytes.set(path, job.markdownLf);
        if (job.checkpointSequence === 4) {
          return { malformed: true, runtimeSequence: job.orderingToken.runtimeSequence };
        }
        return committed(job, path, job.checkpointSequence === 2 ? [assetWarning()] : []);
      }),
      registration(),
    );

    const first = await scheduler.enqueueSaveJob(saveJob(1, "A\n"));
    const second = await scheduler.enqueueSaveJob(saveJob(2, "B\n"));
    const failed = await scheduler.enqueueSaveJob(saveJob(3, "C\n"));
    expect(bytes.get("/docs/post.md")).toBe("B\n");
    expect(first).toMatchObject({ status: "succeeded", filePath: "/docs/post.md" });
    expect(second).toMatchObject({ status: "succeeded", commit: "committed-with-warning" });
    expect(failed).toMatchObject({ status: "failed", commit: "not-committed" });

    const unknown = await scheduler.enqueueSaveJob(saveJob(4, "D\n"));
    expect(bytes.get("/docs/post.md")).toBe("D\n");
    expect(unknown).toMatchObject({ status: "indeterminate", commit: "unknown" });
  });

  it("F4: returns each actual Save As path without leaking requested paths", async () => {
    const bytes = new Map<string, string>();
    const actualPaths = ["/chosen/a.md", "/chosen/b.md"];
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => {
        const path = actualPaths[job.orderingToken.runtimeSequence - 1];
        bytes.set(path, job.markdownLf);
        return committed(job, path);
      }),
      registration(),
    );

    const first = await scheduler.enqueueSaveJob(promptJob(1, "A\n", "/suggested/one.md"));
    const second = await scheduler.enqueueSaveJob(promptJob(2, "B\n", "/suggested/two.md"));

    expect(first).toMatchObject({ status: "succeeded", filePath: "/chosen/a.md" });
    expect(second).toMatchObject({ status: "succeeded", filePath: "/chosen/b.md" });
    expect([...bytes.entries()]).toEqual([
      ["/chosen/a.md", "A\n"],
      ["/chosen/b.md", "B\n"],
    ]);
  });

  it("F5: reserves queue order synchronously and fails closed on sequence regressions", async () => {
    const adapter = nativeAdapter(async (job) => committed(job, "/docs/post.md"));
    const scheduler = createFileSaveScheduler(adapter, registration());

    const first = scheduler.enqueueSaveJob(saveJob(1));
    expect(captureInvariant(() => scheduler.enqueueSaveJob(saveJob(1))).code).toBe(
      "NON_MONOTONIC_CHECKPOINT_SEQUENCE",
    );
    expect(captureInvariant(() => scheduler.enqueueSaveJob(saveJob(2, "bad\r\n"))).code).toBe(
      "INVALID_SAVE_JOB",
    );
    await first;
  });

  it("F5: never wraps or reuses a runtime sequence", async () => {
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => committed(job, "/docs/post.md")),
      { epoch: 1, id: 1, sequenceSeed: Number.MAX_SAFE_INTEGER - 1 },
    );

    await expect(scheduler.enqueueSaveJob(saveJob(1))).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(captureInvariant(() => scheduler.enqueueSaveJob(saveJob(2))).code).toBe(
      "RUNTIME_SEQUENCE_EXHAUSTED",
    );
  });

  it("F5: snapshots registration and destination before queued execution", async () => {
    const registrationInput = { epoch: 1, id: 11, sequenceSeed: 0 };
    const destination = { kind: "current-path" as const, path: "/docs/original.md" };
    let observed: NativeFileSaveJob | undefined;
    const scheduler = createFileSaveScheduler(
      nativeAdapter(async (job) => {
        observed = job;
        return committed(job, job.destination.kind === "current-path" ? job.destination.path : "");
      }),
      registrationInput,
    );

    const save = scheduler.enqueueSaveJob({ ...saveJob(1), destination });
    registrationInput.epoch = 9;
    destination.path = "/docs/mutated.md";
    await save;

    expect(observed).toMatchObject({
      destination: { path: "/docs/original.md" },
      orderingToken: { epoch: 1, id: 11, runtimeSequence: 1 },
    });
    expect(Object.isFrozen(observed?.destination)).toBe(true);
  });

  it("N4/N5: timeout is indeterminate, releases JS FIFO, and records only late diagnostics", async () => {
    let releaseFirst: (() => void) | undefined;
    const invoked: number[] = [];
    const bytes = new Map<string, string>();
    const lateResult = vi.fn();
    let nativeGate: Promise<void> = Promise.resolve();
    const scheduler = createFileSaveScheduler(
      nativeAdapter((job) => {
        invoked.push(job.orderingToken.runtimeSequence);
        const result = nativeGate.then(async () => {
          if (job.orderingToken.runtimeSequence === 1) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
          bytes.set("/docs/post.md", job.markdownLf);
          return committed(job, "/docs/post.md");
        });
        nativeGate = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
      registration(),
      { timeoutMs: 10, onLateResult: lateResult },
    );

    const first = scheduler.enqueueSaveJob(saveJob(1, "B\n"));
    const second = scheduler.enqueueSaveJob(saveJob(2, "C\n"));
    await expect(first).resolves.toMatchObject({
      status: "indeterminate",
      errorCode: "native-save-timeout",
    });
    await nextMicrotask();
    expect(invoked).toEqual([1, 2]);
    expect(bytes.has("/docs/post.md")).toBe(false);

    releaseFirst?.();
    await expect(second).resolves.toMatchObject({ status: "succeeded" });
    await nextMicrotask();
    expect(bytes.get("/docs/post.md")).toBe("C\n");
    expect(lateResult).toHaveBeenCalledWith({ jobId: "save-1", status: "resolved" });
  });
});

function registration() {
  return { epoch: 1, id: 11, sequenceSeed: 0 } as const;
}

function saveJob(sequence: number, markdownLf = `${sequence}\n`): FileSaveJob {
  return {
    jobId: `save-${sequence}`,
    checkpointSequence: sequence,
    documentGeneration: 0,
    markdownLf,
    destination: { kind: "current-path", path: "/docs/post.md" },
  };
}

function promptJob(sequence: number, markdownLf: string, suggestedPath: string): FileSaveJob {
  return {
    ...saveJob(sequence, markdownLf),
    destination: { kind: "prompt", suggestedPath },
  };
}

function nativeAdapter(run: (job: NativeFileSaveJob) => Promise<unknown>): NativeSaveAdapter {
  return { saveMarkdownJob: vi.fn(run) };
}

function committed(
  job: NativeFileSaveJob,
  filePath: string,
  warnings: readonly FileSaveWarning[] = [],
) {
  return {
    status: "committed",
    runtimeSequence: job.orderingToken.runtimeSequence,
    filePath,
    warnings,
  } as const;
}

function notCommitted(
  job: NativeFileSaveJob,
  disposition: "failed" | "cancelled",
  phase: "validation" | "dialog" | "temp-write" | "temp-sync" | "rename",
  errorCode?: string,
) {
  return {
    status: "not-committed",
    disposition,
    runtimeSequence: job.orderingToken.runtimeSequence,
    phase,
    ...(errorCode ? { errorCode } : {}),
  } as const;
}

function assetWarning(): FileSaveWarning {
  return {
    code: "asset-directory-registration-failed",
    message: "The document was saved, but image preview access could not be registered.",
  };
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function captureInvariant(run: () => unknown): FileSaveInvariantError {
  try {
    run();
  } catch (error) {
    if (error instanceof FileSaveInvariantError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected FileSaveInvariantError.");
}
