/**
 * @file save-scheduler.ts
 * @module @md-editor/file-system
 * @description
 * 文件保存调度器（File Save Scheduler）。
 *
 * 负责在 Webview 前端严格保序地调度与编排 Markdown 文档的落盘任务。
 *
 * 核心设计原则：
 * 1. 单队列串行化：前端保存任务通过 Promise 链严格保序执行，杜绝跨任务竞争。
 * 2. 单调递增序号（Ordering Token）：每个任务携带前端派发的单调递增序号，与 Rust 后端
 *    `save_runtime.rs` 中的 Gate 形成双向保序协议，丢弃过期的乱序响应。
 * 3. 结果严格分类：对于成功、失败、取消、超期抢占以及未决状态（Indeterminate）提供明确的
 *    类型区分，指导上层 UI 做出精准的状态回显与脏标记恢复。
 */

const MAX_RUNTIME_SEQUENCE = Number.MAX_SAFE_INTEGER;

/**
 * 文件保存的目标路径规范。
 */
export type FileSaveDestination =
  | {
      /** 保存到已存在的具体文件路径 */
      readonly kind: "current-path";
      /** 目标文件系统绝对路径 */
      readonly path: string;
    }
  | {
      /** 弹出原生系统的“另存为”对话框 */
      readonly kind: "prompt";
      /** 建议的默认文件名或路径 */
      readonly suggestedPath?: string;
    };

/**
 * 文件保存过程中产生的非致命性警告。
 */
export interface FileSaveWarning {
  /** 警告类型代码 */
  readonly code: "asset-directory-registration-failed";
  /** 警告的可读性描述信息 */
  readonly message: string;
}

/**
 * 原子落盘流程的执行阶段。
 *
 * 1. `validation`：校验参数、路径与落盘权限。
 * 2. `dialog`：弹出原生文件保存对话框。
 * 3. `temp-write`：向临时文件写入内容。
 * 4. `temp-sync`：刷新磁盘缓冲区确保持久化（fsync）。
 * 5. `rename`：原子重命名临时文件覆盖目标文件。
 */
export type FileSavePhase = "validation" | "dialog" | "temp-write" | "temp-sync" | "rename";

/**
 * 文件保存调度器返回的最终判决结果。
 */
export type FileSaveOutcome =
  | {
      /** 保存成功 */
      readonly status: "succeeded";
      /** 提交状态（已完全提交或带警告提交） */
      readonly commit: "committed" | "committed-with-warning";
      /** 实际落盘的文件绝对路径 */
      readonly filePath: string;
      /** 非致命警告列表 */
      readonly warnings: readonly FileSaveWarning[];
    }
  | {
      /** 保存明确失败 */
      readonly status: "failed";
      /** 未提交落盘 */
      readonly commit: "not-committed";
      /** 失败发生的阶段 */
      readonly phase: FileSavePhase;
      /** 错误代码 */
      readonly errorCode: string;
    }
  | {
      /** 用户主动取消（如关闭了保存对话框） */
      readonly status: "cancelled";
      /** 未提交落盘 */
      readonly commit: "not-committed";
      /** 取消发生的阶段（通常为 dialog 阶段） */
      readonly phase: "dialog";
      /** 取消原因 */
      readonly reason: "dialog-cancelled";
    }
  | {
      /**
       * 未决状态（Indeterminate）。
       *
       * 在 IPC 超时或底层抛出无法断定是否落盘的异常时触发。
       * 此时前端不能冒进清除 dirty 标记，必须引导用户或系统进行文件校验。
       */
      readonly status: "indeterminate";
      readonly commit: "unknown";
      /** 目标候选路径（若已知） */
      readonly candidatePath?: string;
      /** 错误代码 */
      readonly errorCode: string;
      /** 强制需要进一步核验标志 */
      readonly verificationRequired: true;
    }
  | {
      /** 任务在提交前已被更新的保存任务抢占（Superseded） */
      readonly status: "superseded-before-commit";
      readonly commit: "not-committed";
      /** 本次任务的运行时序号 */
      readonly runtimeSequence: number;
      /** 抢占此任务的更高序号 */
      readonly supersededByRuntimeSequence: number;
    };

/**
 * 原生保存运行时注册凭证（由后端 `attach_save_runtime` 授予）。
 */
export interface NativeSaveRuntimeRegistration {
  /** 当前主窗口/实例纪元（Epoch），用于隔离多实例与窗口重载 */
  readonly epoch: number;
  /** 注册凭据唯一 ID */
  readonly id: number;
  /** 初始序号种子（Sequence Seed） */
  readonly sequenceSeed: number;
}

/**
 * 随每个保存任务下发给后端的单调保序 Token。
 */
export interface NativeSaveOrderingToken {
  /** 绑定的纪元号 */
  readonly epoch: number;
  /** 凭据 ID */
  readonly id: number;
  /** 单调自增的保存序号 */
  readonly runtimeSequence: number;
}

/**
 * 前端业务层提交的原始保存任务描述。
 */
export interface FileSaveJob {
  /** 任务唯一标识 */
  readonly jobId: string;
  /** 文档检查点序号，用于检测同一世代内的逆向落盘 */
  readonly checkpointSequence: number;
  /** 文档世代号（切换文档时自增） */
  readonly documentGeneration: number;
  /** 标准化 LF 换行的 Markdown 纯文本内容 */
  readonly markdownLf: string;
  /** 保存目标规范 */
  readonly destination: FileSaveDestination;
}

/**
 * 包装了保序 Token 的原生保存任务。
 */
export interface NativeFileSaveJob extends FileSaveJob {
  /** 绑定的保序凭据 */
  readonly orderingToken: NativeSaveOrderingToken;
}

/**
 * Rust 后端返回的原生落盘结果格式。
 */
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

/**
 * 原生平台保存桥接适配器。
 */
export interface NativeSaveAdapter {
  /** 调用原生平台（如 Tauri IPC）执行实际的原子写盘 */
  saveMarkdownJob(job: NativeFileSaveJob): Promise<unknown>;
}

/**
 * 文件保存调度器公开接口。
 */
export interface FileSaveScheduler {
  /**
   * 将一个保存任务推入保序队列排队执行。
   *
   * @param job 待保存的任务描述
   * @returns 解析为本次保存的结构化裁决结果
   */
  enqueueSaveJob(job: FileSaveJob): Promise<FileSaveOutcome>;
}

/**
 * 调度器初始化可选配置。
 */
export interface FileSaveSchedulerOptions {
  /** 单次原生落盘调用的超时时间（毫秒） */
  readonly timeoutMs?: number;
  /** 超时后迟到结果的诊断回调 */
  readonly onLateResult?: (result: {
    readonly jobId: string;
    readonly status: "resolved" | "rejected";
  }) => void;
}

/**
 * 文件保存不变量破坏错误（严重逻辑异常）。
 */
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

/**
 * 创建一个带单调保序与排队机制的文件保存调度器。
 *
 * @param adapter 原生通信适配器
 * @param registration 后端鉴权注册凭据
 * @param options 超时与诊断选项
 * @returns 初始化的调度器实例
 */
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

      // 同步锁定 sequence 序号和队列位置。链式 runner 始终解析为明确的 typed outcome，
      // 单个通信或 IO 异常不会阻塞后续排队的保存任务。
      const result = queueTail.then(() => executeSaveJob(adapter, nativeJob, schedulerOptions));
      queueTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

/**
 * 执行单个排队的保存任务并做顶层异常捕获。
 */
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

/**
 * 包装带超时保护的原生调用过程。
 */
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

/**
 * 将原生返回的 payload 严格校验并解析为前端强类型的 FileSaveOutcome。
 */
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

/**
 * 诊断上报：在原生任务超时被标记为 indeterminate 后迟到的结果。
 */
function reportLateResult(
  options: FileSaveSchedulerOptions,
  jobId: string,
  status: "resolved" | "rejected",
): void {
  try {
    options.onLateResult?.({ jobId, status });
  } catch {
    // 诊断日志或回调不得将已决的状态转化为未捕获的 rejection 或干扰既定状态
  }
}

/**
 * 构造未决（Indeterminate）裁决结果。
 */
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

/**
 * 校验注册凭证的合法性。
 */
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

/**
 * 校验保存任务的合法性（防止空 ID、负世代、含有 CR 回车等非法输入）。
 */
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

/**
 * 校验超时时间参数。
 */
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
