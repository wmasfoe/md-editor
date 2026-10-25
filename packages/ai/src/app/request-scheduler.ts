/**
 * @file app/request-scheduler.ts
 * @module @md-editor/ai
 * @description
 * 优先级 + Scope 自动抢占 + LoRA 适配器亲和度分组请求调度器。
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
   * 关联的 LoRA 适配器分组（如 "gec" | "completion" | "distill" | "base"），
   * 多 Slot 并发时同组并行、跨组排队隔离，避免全局 LoRA scale 切换串扰。
   */
  readonly loraGroup?: string;
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
  readonly loraGroup: string;
  readonly controller: AbortController;
  readonly run: (context: AiScheduledRequestContext) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  status: AiRequestStatus;
}

const PRIORITY_ORDER: readonly AiRequestPriority[] = ["urgent", "normal", "background"];

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
  private nextSequence = 1;
  private activeCount = 0;
  private activeLoRaGroup: string | null = null;

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
    const loraGroup = options.loraGroup ?? options.scope.task;

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
        loraGroup,
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

  public get currentLoRaGroup(): string | null {
    return this.activeLoRaGroup;
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
    if (this.activeCount === 0) {
      this.activeLoRaGroup = null;
    }

    if (this.activeLoRaGroup !== null) {
      for (const priority of PRIORITY_ORDER) {
        const queue = this.queues[priority];
        const matchIndex = queue.findIndex((req) => req.loraGroup === this.activeLoRaGroup);
        if (matchIndex >= 0) {
          return queue.splice(matchIndex, 1)[0];
        }
      }
      return undefined;
    }

    for (const priority of PRIORITY_ORDER) {
      const request = this.queues[priority].shift();
      if (request) {
        this.activeLoRaGroup = request.loraGroup;
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
        if (this.activeCount === 0) {
          this.activeLoRaGroup = null;
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
