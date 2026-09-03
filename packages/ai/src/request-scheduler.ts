import type { AiTaskKind } from "./types.ts";

/** 用户可见操作优先于编辑自动任务，编辑自动任务优先于后台分析。 */
export type AiRequestPriority = "urgent" | "normal" | "background";

export type AiRequestStatus = "queued" | "running" | "completed" | "cancelled" | "stale" | "failed";

/**
 * 用于识别“同一个位置/文档上的同类请求”。
 *
 * 调度器不解释 documentRevision 与 anchor 的业务含义；调用者用它们构造稳定 scope，
 * 从而让补全、纠错、总结各自有正确的覆盖边界。
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
  /** 当前请求是否仍是该 scope 的最新有效请求。 */
  readonly isCurrent: () => boolean;
}

export interface AiScheduleOptions<T> {
  readonly scope: AiRequestScope;
  readonly priority: AiRequestPriority;
  /**
   * 同 scope 的新请求是否取代旧请求。默认 true：GEC/Completion 应只保留最新输入。
   * 总结、风格分析若需合并，调用方可传 false 并自行使用稳定 scope 去重。
   */
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
  readonly controller: AbortController;
  readonly run: (context: AiScheduledRequestContext) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  status: AiRequestStatus;
}

const PRIORITY_ORDER: readonly AiRequestPriority[] = ["urgent", "normal", "background"];

/**
 * 本地 AI 请求调度器。
 *
 * 默认并发为 1，对应当前 llama-server `--parallel 1`。未来只需把 maxConcurrency
 * 提升到 slot 数；调用方与任务语义不需要改写。
 */
export class AiRequestScheduler {
  private readonly queues: Record<AiRequestPriority, QueuedRequest<unknown>[]> = {
    urgent: [],
    normal: [],
    background: [],
  };
  private readonly latestByScope = new Map<string, string>();
  private readonly activeById = new Map<string, QueuedRequest<unknown>>();
  private nextSequence = 1;
  private activeCount = 0;

  public constructor(private readonly maxConcurrency = 1) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("maxConcurrency 必须是大于 0 的整数。");
    }
  }

  public schedule<T>(options: AiScheduleOptions<T>): AiScheduledRequest<T> {
    const scopeKey = createAiRequestScopeKey(options.scope);
    const requestId = `ai-${this.nextSequence++}`;
    const controller = new AbortController();
    const replace = options.replace !== false;

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
    return this.activeCount;
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency) {
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

  private takeNext(): QueuedRequest<unknown> | undefined {
    for (const priority of PRIORITY_ORDER) {
      const request = this.queues[priority].shift();
      if (request) {
        return request;
      }
    }
    return undefined;
  }

  private execute(request: QueuedRequest<unknown>): void {
    request.status = "running";
    this.activeCount += 1;
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
          // cancelRequest 已拒绝 promise；避免二次 settle。
          return;
        }
        request.status = "failed";
        request.reject(error);
      })
      .finally(() => {
        this.activeCount -= 1;
        this.activeById.delete(request.requestId);
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
