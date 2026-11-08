/**
 * @file app/request-scheduler.ts
 * @module @md-editor/ai
 * @description
 * 优先级 + Scope 自动抢占 + runtime 亲和键分组 + 独占可抢占后台任务的请求调度器。
 *
 * 本地推理 runtime 是单进程、单模型、全局 LoRA scale 的共享状态：
 * - 亲和键（affinityKey）相同的请求可以并发，不同的必须排队，避免模型/LoRA 串扰；
 * - 云端请求不触碰 runtime 状态，亲和键为 null，可与任何请求并发；
 * - 独占任务（exclusive，如风格学习）只在调度器完全空闲时运行，
 *   任何 urgent/normal 请求到达都会立即中止它并释放槽位。
 */

import type { AiTaskKind } from "../domain/types.ts";

/** 用户显式快捷键触发（urgent）优先于自动补全/纠错（normal），再优先于后台文档提炼（background） */
export type AiRequestPriority = "urgent" | "normal" | "background";

export type AiRequestStatus = "queued" | "running" | "completed" | "cancelled" | "stale" | "failed";

/**
 * 用于识别“同一个文档/位置上的同类请求”以执行过期取消。
 */
export interface AiRequestScope {
  readonly workspaceId?: string;
  readonly documentId: string;
  readonly task: AiTaskKind;
  readonly anchor?: string | number;
}

export interface AiScheduledRequestContext {
  readonly requestId: string;
  readonly scopeKey: string;
  readonly scope: AiRequestScope;
  readonly priority: AiRequestPriority;
  readonly signal: AbortSignal;
  /** 当前请求是否仍是该 scope 的最新有效请求 */
  readonly isCurrent: () => boolean;
}

export interface AiScheduleOptions<T> {
  readonly scope: AiRequestScope;
  readonly priority: AiRequestPriority;
  /**
   * runtime 亲和键：本地请求用 {@link createLocalAffinityKey} 生成（模型 + LoRA 任务），
   * 同键可并发、异键排队；云端请求传 null 或省略，不参与亲和隔离。
   */
  readonly affinityKey?: string | null;
  /**
   * 独占可抢占任务：仅在没有任何运行中请求、且 urgent/normal 队列为空时派发；
   * 运行期间不派发其他请求；任何 urgent/normal 请求到达时以 `preempted` 立即中止并释放槽位。
   */
  readonly exclusive?: boolean;
  /** 同 scope 的新请求是否取代旧请求（默认 true） */
  readonly replace?: boolean;
  readonly run: (context: AiScheduledRequestContext) => Promise<T>;
}

export interface AiScheduledRequest<T> {
  readonly requestId: string;
  readonly scopeKey: string;
  readonly promise: Promise<T>;
  cancel: () => void;
}

interface QueuedRequest<T> {
  readonly requestId: string;
  readonly scopeKey: string;
  readonly scope: AiRequestScope;
  readonly priority: AiRequestPriority;
  readonly affinityKey: string | null;
  readonly exclusive: boolean;
  readonly controller: AbortController;
  readonly run: (context: AiScheduledRequestContext) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  status: AiRequestStatus;
}

const PRIORITY_ORDER: readonly AiRequestPriority[] = ["urgent", "normal", "background"];

/** 独占任务被用户请求抢占时的取消原因 */
export const AI_REQUEST_PREEMPTED_REASON = "preempted";

/**
 * 生成本地 runtime 亲和键。同一模型 + 同一 LoRA 任务的请求才允许并发。
 */
export function createLocalAffinityKey(modelId: string, lora: string): string {
  return `local:${modelId}:${lora}`;
}

/**
 * AI 请求并发与取消调度器。
 */
export class AiRequestScheduler {
  private readonly queues: Record<AiRequestPriority, QueuedRequest<unknown>[]> = {
    urgent: [],
    normal: [],
    background: [],
  };
  private readonly latestByScope = new Map<string, string>();
  private readonly activeById = new Map<string, QueuedRequest<unknown>>();
  /** 正在占用槽位的请求；被抢占的独占任务会立即移出以释放槽位 */
  private readonly running = new Set<QueuedRequest<unknown>>();
  private nextSequence = 1;

  public constructor(private readonly maxConcurrency = 2) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("maxConcurrency 必须是大于 0 的整数。");
    }
  }

  public schedule<T>(options: AiScheduleOptions<T>): AiScheduledRequest<T> {
    const scopeKey = createAiRequestScopeKey(options.scope);
    const requestId = `ai-${this.nextSequence++}`;
    const controller = new AbortController();
    const replace = options.replace !== false;
    const affinityKey = options.affinityKey ?? null;
    const exclusive = options.exclusive === true;

    if (replace) {
      this.cancelScope(scopeKey, "superseded");
    }
    this.latestByScope.set(scopeKey, requestId);

    let requestRef: QueuedRequest<T> | null = null;
    const promise = new Promise<T>((resolve, reject) => {
      requestRef = {
        requestId,
        scopeKey,
        scope: options.scope,
        priority: options.priority,
        affinityKey,
        exclusive,
        controller,
        run: options.run,
        resolve,
        reject,
        status: "queued",
      };
    });

    if (!requestRef) {
      throw new Error("AI 调度请求初始化失败。");
    }
    const request = requestRef;
    this.queues[options.priority].push(request as QueuedRequest<unknown>);
    this.activeById.set(requestId, request as QueuedRequest<unknown>);
    if (!exclusive && options.priority !== "background") {
      this.preemptExclusive();
    }
    this.pump();

    return {
      requestId,
      scopeKey,
      promise,
      cancel: () => this.cancelRequest(requestId, "cancelled"),
    };
  }

  public cancelScope(scope: AiRequestScope | string, reason = "cancelled"): void {
    const scopeKey = typeof scope === "string" ? scope : createAiRequestScopeKey(scope);
    const requestId = this.latestByScope.get(scopeKey);
    if (requestId) {
      this.cancelRequest(requestId, reason);
    }
  }

  /**
   * 中断指定文档（或全部文档）指定任务类型的所有在途或排队中的 AI 请求。
   */
  public cancelDocument(documentId?: string, task?: AiTaskKind, reason = "aborted"): void {
    const toCancel: QueuedRequest<unknown>[] = [];
    for (const req of this.activeById.values()) {
      if (
        (!documentId || req.scope.documentId === documentId) &&
        (!task || req.scope.task === task)
      ) {
        toCancel.push(req);
      }
    }
    for (const priority of PRIORITY_ORDER) {
      for (const req of this.queues[priority]) {
        if (
          (!documentId || req.scope.documentId === documentId) &&
          (!task || req.scope.task === task)
        ) {
          if (!toCancel.includes(req)) {
            toCancel.push(req);
          }
        }
      }
    }
    for (const req of toCancel) {
      this.cancelRequest(req.requestId, reason);
    }
  }

  public cancelRequest(requestId: string, reason = "cancelled"): void {
    const request = this.activeById.get(requestId);
    if (!request || request.status === "completed" || request.status === "failed") {
      return;
    }
    request.status = "cancelled";
    request.controller.abort(reason);
    this.removeQueuedRequest(request);
    if (this.latestByScope.get(request.scopeKey) === requestId) {
      this.latestByScope.delete(request.scopeKey);
    }
    this.activeById.delete(requestId);
    request.reject(createAiRequestAbortError(reason));
  }

  public get pendingCount(): number {
    return PRIORITY_ORDER.reduce((count, priority) => count + this.queues[priority].length, 0);
  }

  public get runningCount(): number {
    return this.running.size;
  }

  /** 当前运行中本地请求的亲和键；只有云端请求或空闲时为 null */
  public get currentAffinityKey(): string | null {
    for (const request of this.running) {
      if (request.affinityKey !== null) {
        return request.affinityKey;
      }
    }
    return null;
  }

  /**
   * 中止所有运行中的独占任务，并立即释放其槽位，使用户请求在同一 tick 内派发。
   */
  private preemptExclusive(): void {
    // 先收集再处理，避免在遍历 running 时修改它。
    const exclusive = Array.from(this.running).filter((request) => request.exclusive);
    for (const request of exclusive) {
      this.running.delete(request);
      this.cancelRequest(request.requestId, AI_REQUEST_PREEMPTED_REASON);
    }
  }

  private pump(): void {
    while (this.running.size < this.maxConcurrency) {
      const request = this.takeNext();
      if (!request) {
        return;
      }
      if (request.status !== "queued" || request.controller.signal.aborted) {
        continue;
      }
      this.execute(request);
    }
  }

  /**
   * 按优先级取出第一个当前可派发的请求。
   */
  private takeNext(): QueuedRequest<unknown> | undefined {
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues[priority];
      const index = queue.findIndex((request) => this.canDispatch(request));
      if (index >= 0) {
        return queue.splice(index, 1)[0];
      }
    }
    return undefined;
  }

  private canDispatch(request: QueuedRequest<unknown>): boolean {
    if (request.exclusive) {
      return (
        this.running.size === 0 &&
        this.queues.urgent.length === 0 &&
        this.queues.normal.length === 0
      );
    }
    let runningAffinity: string | null = null;
    for (const active of this.running) {
      if (active.exclusive) {
        return false;
      }
      runningAffinity ??= active.affinityKey;
    }
    return (
      request.affinityKey === null ||
      runningAffinity === null ||
      runningAffinity === request.affinityKey
    );
  }

  private execute(request: QueuedRequest<unknown>): void {
    request.status = "running";
    this.running.add(request);
    const isCurrent = () =>
      this.latestByScope.get(request.scopeKey) === request.requestId &&
      !request.controller.signal.aborted;

    void request
      .run({
        requestId: request.requestId,
        scopeKey: request.scopeKey,
        scope: request.scope,
        priority: request.priority,
        signal: request.controller.signal,
        isCurrent,
      })
      .then((result) => {
        if (!isCurrent()) {
          request.status = "stale";
          request.reject(createAiRequestAbortError("stale"));
          return;
        }
        request.status = "completed";
        request.resolve(result);
      })
      .catch((error: unknown) => {
        if (request.controller.signal.aborted) {
          return;
        }
        request.status = "failed";
        request.reject(error);
      })
      .finally(() => {
        // 被抢占的独占任务已提前释放槽位，这里不能重复释放。
        this.running.delete(request);
        if (this.activeById.get(request.requestId) === request) {
          this.activeById.delete(request.requestId);
        }
        if (this.latestByScope.get(request.scopeKey) === request.requestId) {
          this.latestByScope.delete(request.scopeKey);
        }
        this.pump();
      });
  }

  private removeQueuedRequest(request: QueuedRequest<unknown>): void {
    const queue = this.queues[request.priority];
    const index = queue.indexOf(request);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }
}

export function createAiRequestScopeKey(scope: AiRequestScope): string {
  return JSON.stringify([
    scope.workspaceId ?? "",
    scope.documentId,
    scope.task,
    scope.anchor ?? "",
  ]);
}

function createAiRequestAbortError(reason: string): Error {
  const error = new Error(`AI 请求已取消：${reason}`);
  error.name = "AbortError";
  return error;
}
