import { describe, expect, it } from "vitest";

import {
  AiRequestScheduler,
  createAiRequestScopeKey,
  type AiScheduledRequestContext,
} from "../src/request-scheduler.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function context(documentId: string, task: "gec" | "completion" | "distill" = "gec") {
  return { documentId, task } as const;
}

describe("AiRequestScheduler", () => {
  it("runs urgent work before normal and background work when a slot becomes free", async () => {
    const scheduler = new AiRequestScheduler(1);
    const first = deferred<string>();
    const order: string[] = [];

    const active = scheduler.schedule({
      scope: context("active"),
      priority: "normal",
      run: async () => first.promise,
    });
    await waitForMicrotasks();

    const background = scheduler.schedule({
      scope: context("background", "distill"),
      priority: "background",
      run: async () => {
        order.push("background");
        return "background";
      },
    });
    const normal = scheduler.schedule({
      scope: context("normal", "completion"),
      priority: "normal",
      run: async () => {
        order.push("normal");
        return "normal";
      },
    });
    const urgent = scheduler.schedule({
      scope: context("urgent", "gec"),
      priority: "urgent",
      run: async () => {
        order.push("urgent");
        return "urgent";
      },
    });

    first.resolve("active");
    await active.promise;
    await Promise.all([urgent.promise, normal.promise, background.promise]);
    expect(order).toEqual(["urgent", "normal", "background"]);
  });

  it("replaces an older same-scope request and exposes only the newest request as current", async () => {
    const scheduler = new AiRequestScheduler(1);
    const first = deferred<string>();
    const scope = context("draft.md", "completion");

    const older = scheduler.schedule({
      scope,
      priority: "normal",
      run: async () => first.promise,
    });
    await waitForMicrotasks();

    const newer = scheduler.schedule({
      scope,
      priority: "normal",
      run: async (request) => {
        expect(request.isCurrent()).toBe(true);
        return "new";
      },
    });

    await expect(older.promise).rejects.toMatchObject({ name: "AbortError" });
    first.resolve("old");
    await expect(newer.promise).resolves.toBe("new");
  });

  it("keeps different documents independent even when their task kinds are the same", async () => {
    const scheduler = new AiRequestScheduler(1);
    expect(createAiRequestScopeKey(context("a.md"))).not.toBe(
      createAiRequestScopeKey(context("b.md")),
    );

    const first = scheduler.schedule({
      scope: context("a.md"),
      priority: "normal",
      run: async () => "a",
    });
    const second = scheduler.schedule({
      scope: context("b.md"),
      priority: "normal",
      run: async () => "b",
    });

    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual(["a", "b"]);
  });

  it("passes AbortSignal to task execution and supports explicit cancellation", async () => {
    const scheduler = new AiRequestScheduler(1);
    const started = deferred<AiScheduledRequestContext>();
    const never = deferred<string>();
    const request = scheduler.schedule({
      scope: context("cancel.md"),
      priority: "urgent",
      run: async (runtime) => {
        started.resolve(runtime);
        return never.promise;
      },
    });

    const runtime = await started.promise;
    request.cancel();
    expect(runtime.signal.aborted).toBe(true);
    await expect(request.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("P3: 同 LoRA 分组的任务可在多 Slot (maxConcurrency=2) 下并发执行", async () => {
    const scheduler = new AiRequestScheduler(2);
    const firstDef = deferred<string>();
    const secondDef = deferred<string>();
    const running: string[] = [];

    const req1 = scheduler.schedule({
      scope: context("doc1.md", "gec"),
      priority: "normal",
      loraGroup: "gec",
      run: async () => {
        running.push("gec-1");
        return firstDef.promise;
      },
    });

    const req2 = scheduler.schedule({
      scope: context("doc2.md", "gec"),
      priority: "normal",
      loraGroup: "gec",
      run: async () => {
        running.push("gec-2");
        return secondDef.promise;
      },
    });

    await waitForMicrotasks();
    // 两个同为 "gec" 的请求应同时进入 running 状态
    expect(running).toEqual(["gec-1", "gec-2"]);
    expect(scheduler.runningCount).toBe(2);
    expect(scheduler.currentLoRaGroup).toBe("gec");

    firstDef.resolve("res1");
    secondDef.resolve("res2");
    await expect(Promise.all([req1.promise, req2.promise])).resolves.toEqual(["res1", "res2"]);
    expect(scheduler.runningCount).toBe(0);
    expect(scheduler.currentLoRaGroup).toBeNull();
  });

  it("P3: 跨 LoRA 分组的任务在并发时严格排队等待前组 drain，杜绝全局权重串扰", async () => {
    const scheduler = new AiRequestScheduler(2);
    const gecDef = deferred<string>();
    const events: string[] = [];

    // Slot 1 启动运行 GEC
    const gecReq = scheduler.schedule({
      scope: context("doc1.md", "gec"),
      priority: "normal",
      loraGroup: "gec",
      run: async () => {
        events.push("start:gec");
        return gecDef.promise;
      },
    });

    await waitForMicrotasks();
    expect(events).toEqual(["start:gec"]);
    expect(scheduler.runningCount).toBe(1);
    expect(scheduler.currentLoRaGroup).toBe("gec");

    // 此时提交 Distill 请求（不同 LoRA 分组）
    const distillReq = scheduler.schedule({
      scope: context("doc2.md", "distill"),
      priority: "normal",
      loraGroup: "distill",
      run: async () => {
        events.push("start:distill");
        return "distill-done";
      },
    });

    await waitForMicrotasks();
    // 尽管空闲 Slot 2 可用，但由于属于不同 LoRA 组，distill 不允许立即启动，必须等待 gec 完成
    expect(events).toEqual(["start:gec"]);
    expect(scheduler.runningCount).toBe(1);

    // GEC 完成并释放
    gecDef.resolve("gec-done");
    await gecReq.promise;

    await waitForMicrotasks();
    // GEC 退出后，activeCount 归零，LoRA 组切换为 distill 并开始执行
    expect(events).toEqual(["start:gec", "start:distill"]);
    await expect(distillReq.promise).resolves.toBe("distill-done");
    expect(scheduler.runningCount).toBe(0);
  });
});
