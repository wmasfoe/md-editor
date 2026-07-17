const MAX_RUNTIME_SEQUENCE = Number.MAX_SAFE_INTEGER;

export type FileSaveDestination =
  | { readonly kind: "current-path"; readonly path: string }
  | { readonly kind: "prompt"; readonly suggestedPath?: string };

export interface FileSaveWarning {
  readonly code: "asset-directory-registration-failed";
  readonly message: string;
}

export type FileSavePhase = "validation" | "dialog" | "temp-write" | "temp-sync" | "rename";

export type FileSaveOutcome =
  | {
      readonly status: "succeeded";
      readonly commit: "committed" | "committed-with-warning";
      readonly filePath: string;
      readonly warnings: readonly FileSaveWarning[];
    }
  | {
      readonly status: "failed";
      readonly commit: "not-committed";
      readonly phase: FileSavePhase;
      readonly errorCode: string;
    }
  | {
      readonly status: "cancelled";
      readonly commit: "not-committed";
      readonly phase: "dialog";
      readonly reason: "dialog-cancelled";
    }
  | {
      readonly status: "indeterminate";
      readonly commit: "unknown";
      readonly candidatePath?: string;
      readonly errorCode: string;
      readonly verificationRequired: true;
    }
  | {
      readonly status: "superseded-before-commit";
      readonly commit: "not-committed";
      readonly runtimeSequence: number;
      readonly supersededByRuntimeSequence: number;
    };

export interface NativeSaveRuntimeRegistration {
  readonly epoch: number;
  readonly id: number;
  readonly sequenceSeed: number;
}

export interface NativeSaveOrderingToken {
  readonly epoch: number;
  readonly id: number;
  readonly runtimeSequence: number;
}

export interface FileSaveJob {
  readonly jobId: string;
  readonly checkpointSequence: number;
  readonly documentGeneration: number;
  readonly markdownLf: string;
  readonly destination: FileSaveDestination;
}

export interface NativeFileSaveJob extends FileSaveJob {
  readonly orderingToken: NativeSaveOrderingToken;
}

export type NativeSaveResult =
  | {
      readonly status: "committed";
      readonly runtimeSequence: number;
      readonly filePath: string;
      readonly warnings: readonly FileSaveWarning[];
    }
  | {
      readonly status: "not-committed";
      readonly disposition: "failed" | "cancelled";
      readonly runtimeSequence: number;
      readonly phase: FileSavePhase;
      readonly errorCode?: string;
    }
  | {
      readonly status: "superseded-before-commit";
      readonly reason: "retired-epoch" | "non-monotonic-sequence";
      readonly runtimeSequence: number;
      readonly currentEpoch: number;
      readonly highestAdmittedRuntimeSequence: number;
    }
  | {
      readonly status: "indeterminate";
      readonly runtimeSequence: number;
      readonly errorCode: string;
    };

export interface NativeSaveAdapter {
  saveMarkdownJob(job: NativeFileSaveJob): Promise<unknown>;
}

export interface FileSaveScheduler {
  enqueueSaveJob(job: FileSaveJob): Promise<FileSaveOutcome>;
}

export interface FileSaveSchedulerOptions {
  readonly timeoutMs?: number;
  readonly onLateResult?: (result: {
    readonly jobId: string;
    readonly status: "resolved" | "rejected";
  }) => void;
}

export class FileSaveInvariantError extends Error {
  readonly code:
    | "INVALID_REGISTRATION"
    | "INVALID_SAVE_JOB"
    | "NON_MONOTONIC_CHECKPOINT_SEQUENCE"
    | "RUNTIME_SEQUENCE_EXHAUSTED";

  constructor(code: FileSaveInvariantError["code"], message: string) {
    super(message);
    this.name = "FileSaveInvariantError";
    this.code = code;
  }
}

export function createFileSaveScheduler(
  adapter: NativeSaveAdapter,
  registration: NativeSaveRuntimeRegistration,
  options: FileSaveSchedulerOptions = {},
): FileSaveScheduler {
  validateRegistration(registration);
  validateTimeout(options.timeoutMs);

  const runtimeRegistration = Object.freeze({ ...registration });
  const schedulerOptions = Object.freeze({ ...options });
  let nextRuntimeSequence = runtimeRegistration.sequenceSeed;
  let queueTail: Promise<void> = Promise.resolve();
  const latestCheckpointSequenceByGeneration = new Map<number, number>();

  return {
    enqueueSaveJob(job) {
      validateSaveJob(job);
      const previousCheckpointSequence = latestCheckpointSequenceByGeneration.get(
        job.documentGeneration,
      );
      if (
        previousCheckpointSequence !== undefined &&
        job.checkpointSequence <= previousCheckpointSequence
      ) {
        throw new FileSaveInvariantError(
          "NON_MONOTONIC_CHECKPOINT_SEQUENCE",
          `Checkpoint sequence ${job.checkpointSequence} must be greater than ${previousCheckpointSequence} for generation ${job.documentGeneration}.`,
        );
      }

      if (nextRuntimeSequence >= MAX_RUNTIME_SEQUENCE) {
        throw new FileSaveInvariantError(
          "RUNTIME_SEQUENCE_EXHAUSTED",
          "The native save runtime sequence is exhausted; restart the app process before saving again.",
        );
      }

      latestCheckpointSequenceByGeneration.set(job.documentGeneration, job.checkpointSequence);
      nextRuntimeSequence += 1;
      const nativeJob: NativeFileSaveJob = Object.freeze({
        ...job,
        destination: Object.freeze({ ...job.destination }),
        orderingToken: Object.freeze({
          epoch: runtimeRegistration.epoch,
          id: runtimeRegistration.id,
          runtimeSequence: nextRuntimeSequence,
        }),
      });

      // Reserve sequence and queue position synchronously. The chained runner always
      // resolves a typed outcome so one bad transport cannot wedge later saves.
      const result = queueTail.then(() => executeSaveJob(adapter, nativeJob, schedulerOptions));
      queueTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

async function executeSaveJob(
  adapter: NativeSaveAdapter,
  job: NativeFileSaveJob,
  options: FileSaveSchedulerOptions,
): Promise<FileSaveOutcome> {
  try {
    const payload = await invokeNativeSave(adapter, job, options);
    return classifyNativeSaveResult(payload, job);
  } catch (error) {
    return indeterminateOutcome(
      job,
      error instanceof NativeSaveTimeoutError
        ? "native-save-timeout"
        : "native-save-transport-error",
    );
  }
}

function invokeNativeSave(
  adapter: NativeSaveAdapter,
  job: NativeFileSaveJob,
  options: FileSaveSchedulerOptions,
): Promise<unknown> {
  const invocation = Promise.resolve().then(() => adapter.saveMarkdownJob(job));
  const timeoutMs = options.timeoutMs;
  if (timeoutMs === undefined) {
    return invocation;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new NativeSaveTimeoutError());
    }, timeoutMs);

    void invocation.then(
      (value) => {
        clearTimeout(timer);
        if (settled) {
          reportLateResult(options, job.jobId, "resolved");
          return;
        }
        settled = true;
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        if (settled) {
          reportLateResult(options, job.jobId, "rejected");
          return;
        }
        settled = true;
        reject(new Error("Native save invocation rejected."));
      },
    );
  });
}

function classifyNativeSaveResult(payload: unknown, job: NativeFileSaveJob): FileSaveOutcome {
  if (!isRecord(payload) || payload.runtimeSequence !== job.orderingToken.runtimeSequence) {
    return indeterminateOutcome(job, "native-save-invalid-payload");
  }

  if (
    payload.status === "committed" &&
    typeof payload.filePath === "string" &&
    payload.filePath.length > 0 &&
    isSaveWarnings(payload.warnings)
  ) {
    return {
      status: "succeeded",
      commit: payload.warnings.length === 0 ? "committed" : "committed-with-warning",
      filePath: payload.filePath,
      warnings: payload.warnings,
    };
  }

  if (
    payload.status === "not-committed" &&
    isSavePhase(payload.phase) &&
    (payload.disposition === "failed" || payload.disposition === "cancelled")
  ) {
    if (payload.disposition === "cancelled" && payload.phase === "dialog") {
      return {
        status: "cancelled",
        commit: "not-committed",
        phase: "dialog",
        reason: "dialog-cancelled",
      };
    }
    if (payload.disposition === "failed" && typeof payload.errorCode === "string") {
      return {
        status: "failed",
        commit: "not-committed",
        phase: payload.phase,
        errorCode: payload.errorCode,
      };
    }
  }

  if (
    payload.status === "superseded-before-commit" &&
    (payload.reason === "retired-epoch" || payload.reason === "non-monotonic-sequence") &&
    isNonNegativeSafeInteger(payload.highestAdmittedRuntimeSequence)
  ) {
    return {
      status: "superseded-before-commit",
      commit: "not-committed",
      runtimeSequence: job.orderingToken.runtimeSequence,
      supersededByRuntimeSequence: payload.highestAdmittedRuntimeSequence,
    };
  }

  if (payload.status === "indeterminate" && typeof payload.errorCode === "string") {
    return indeterminateOutcome(job, payload.errorCode);
  }

  return indeterminateOutcome(job, "native-save-invalid-payload");
}

function reportLateResult(
  options: FileSaveSchedulerOptions,
  jobId: string,
  status: "resolved" | "rejected",
): void {
  try {
    options.onLateResult?.({ jobId, status });
  } catch {
    // Diagnostics must not turn an already-settled native invocation into an
    // unhandled rejection or influence save authority.
  }
}

function indeterminateOutcome(job: NativeFileSaveJob, errorCode: string): FileSaveOutcome {
  const candidatePath =
    job.destination.kind === "current-path" ? job.destination.path : job.destination.suggestedPath;
  return {
    status: "indeterminate",
    commit: "unknown",
    ...(candidatePath ? { candidatePath } : {}),
    errorCode,
    verificationRequired: true,
  };
}

function validateRegistration(registration: NativeSaveRuntimeRegistration): void {
  if (
    !isPositiveSafeInteger(registration.epoch) ||
    !isPositiveSafeInteger(registration.id) ||
    !isNonNegativeSafeInteger(registration.sequenceSeed) ||
    registration.sequenceSeed >= MAX_RUNTIME_SEQUENCE
  ) {
    throw new FileSaveInvariantError(
      "INVALID_REGISTRATION",
      "Native save registration must contain positive safe epoch/id values and a non-negative sequence seed.",
    );
  }
}

function validateSaveJob(job: FileSaveJob): void {
  const destinationIsValid =
    (job.destination.kind === "current-path" && job.destination.path.length > 0) ||
    (job.destination.kind === "prompt" &&
      (job.destination.suggestedPath === undefined || job.destination.suggestedPath.length > 0));
  if (
    job.jobId.length === 0 ||
    !isPositiveSafeInteger(job.checkpointSequence) ||
    !isNonNegativeSafeInteger(job.documentGeneration) ||
    job.markdownLf.includes("\r") ||
    !destinationIsValid
  ) {
    throw new FileSaveInvariantError(
      "INVALID_SAVE_JOB",
      "Save jobs require an id, safe checkpoint/generation values, canonical LF Markdown, and a valid destination.",
    );
  }
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && !isPositiveSafeInteger(timeoutMs)) {
    throw new FileSaveInvariantError(
      "INVALID_REGISTRATION",
      "Native save timeout must be a positive safe integer.",
    );
  }
}

function isSavePhase(value: unknown): value is FileSavePhase {
  return (
    value === "validation" ||
    value === "dialog" ||
    value === "temp-write" ||
    value === "temp-sync" ||
    value === "rename"
  );
}

function isSaveWarnings(value: unknown): value is readonly FileSaveWarning[] {
  return (
    Array.isArray(value) &&
    value.every(
      (warning) =>
        isRecord(warning) &&
        warning.code === "asset-directory-registration-failed" &&
        typeof warning.message === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

class NativeSaveTimeoutError extends Error {}
