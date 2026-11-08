import { describe, expect, it } from "vitest";

import {
  AI_REQUEST_PREEMPTED_REASON,
  AiRequestScheduler,
  createAiRequestScopeKey,
  createLocalAffinityKey,
  type AiScheduledRequestContext,
} from "../src/index.ts";

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

function context(
  documentId: string,
  task: "gec" | "completion" | "distill" | "style-analysis" = "gec",
) {
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

  it("P3: 同亲和键的本地任务可在多 Slot (maxConcurrency=2) 下并发执行", async () => {
    const scheduler = new AiRequestScheduler(2);
    const firstDef = deferred<string>();
    const secondDef = deferred<string>();
    const running: string[] = [];

    const req1 = scheduler.schedule({
      scope: context("doc1.md", "gec"),
      priority: "normal",
      affinityKey: createLocalAffinityKey("lite", "gec"),
      run: async () => {
        running.push("gec-1");
        return firstDef.promise;
      },
    });

    const req2 = scheduler.schedule({
      scope: context("doc2.md", "gec"),
      priority: "normal",
      affinityKey: createLocalAffinityKey("lite", "gec"),
      run: async () => {
        running.push("gec-2");
        return secondDef.promise;
      },
    });

    await waitForMicrotasks();
    // 两个同为 "gec" 的请求应同时进入 running 状态
    expect(running).toEqual(["gec-1", "gec-2"]);
    expect(scheduler.runningCount).toBe(2);
    expect(scheduler.currentAffinityKey).toBe(createLocalAffinityKey("lite", "gec"));

    firstDef.resolve("res1");
    secondDef.resolve("res2");
    await expect(Promise.all([req1.promise, req2.promise])).resolves.toEqual(["res1", "res2"]);
    expect(scheduler.runningCount).toBe(0);
    expect(scheduler.currentAffinityKey).toBeNull();
  });

  it("P3: 跨亲和键的本地任务在并发时严格排队等待前组 drain，杜绝全局权重串扰", async () => {
    const scheduler = new AiRequestScheduler(2);
    const gecDef = deferred<string>();
    const events: string[] = [];

    // Slot 1 启动运行 GEC
    const gecReq = scheduler.schedule({
      scope: context("doc1.md", "gec"),
      priority: "normal",
      affinityKey: createLocalAffinityKey("lite", "gec"),
      run: async () => {
        events.push("start:gec");
        return gecDef.promise;
      },
    });

    await waitForMicrotasks();
    expect(events).toEqual(["start:gec"]);
    expect(scheduler.runningCount).toBe(1);
    expect(scheduler.currentAffinityKey).toBe(createLocalAffinityKey("lite", "gec"));

    // 此时提交 Distill 请求（不同 LoRA 分组）
    const distillReq = scheduler.schedule({
      scope: context("doc2.md", "distill"),
      priority: "normal",
      affinityKey: createLocalAffinityKey("lite", "distill"),
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

  it("U-SC-3: 云端请求没有亲和键，可与其他云端请求并发", async () => {
    const scheduler = new AiRequestScheduler(2);
    const first = deferred<string>();
    const second = deferred<string>();
    const running: string[] = [];

    const gec = scheduler.schedule({
      scope: context("cloud-a.md", "gec"),
      priority: "normal",
      run: async () => {
        running.push("gec");
        return first.promise;
      },
    });
    const completion = scheduler.schedule({
      scope: context("cloud-b.md", "completion"),
      priority: "normal",
      affinityKey: null,
      run: async () => {
        running.push("completion");
        return second.promise;
      },
    });

    await waitForMicrotasks();
    expect(running).toEqual(["gec", "completion"]);
    expect(scheduler.currentAffinityKey).toBeNull();
    first.resolve("a");
    second.resolve("b");
    await expect(Promise.all([gec.promise, completion.promise])).resolves.toEqual(["a", "b"]);
  });

  it("U-SC-1: urgent/normal 请求到达时立即中止运行中的独占任务，并在同一 tick 派发", async () => {
    const scheduler = new AiRequestScheduler(1);
    const learningStarted = deferred<AiScheduledRequestContext>();
    const never = deferred<string>();
    const learning = scheduler.schedule({
      scope: context("workspace", "style-analysis"),
      priority: "background",
      exclusive: true,
      affinityKey: createLocalAffinityKey("standard", "none"),
      run: async (runtime) => {
        learningStarted.resolve(runtime);
        return never.promise;
      },
    });
    const learningRuntime = await learningStarted.promise;

    let userStarted = false;
    const user = scheduler.schedule({
      scope: context("draft.md", "completion"),
      priority: "urgent",
      affinityKey: createLocalAffinityKey("lite", "completion"),
      run: async () => {
        userStarted = true;
        return "continued";
      },
    });

    // 抢占与派发同步发生，不需要等待独占任务的 promise 结束。
    expect(learningRuntime.signal.aborted).toBe(true);
    expect(learningRuntime.signal.reason).toBe(AI_REQUEST_PREEMPTED_REASON);
    expect(userStarted).toBe(true);
    await expect(learning.promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(user.promise).resolves.toBe("continued");
    expect(scheduler.runningCount).toBe(0);
  });

  it("U-SC-2: 有用户请求排队或运行时，独占任务不派发", async () => {
    const scheduler = new AiRequestScheduler(2);
    const userWork = deferred<string>();
    const events: string[] = [];

    const user = scheduler.schedule({
      scope: context("draft.md", "gec"),
      priority: "normal",
      run: async () => {
        events.push("start:user");
        return userWork.promise;
      },
    });
    const learning = scheduler.schedule({
      scope: context("workspace", "style-analysis"),
      priority: "background",
      exclusive: true,
      run: async () => {
        events.push("start:learning");
        return "learned";
      },
    });

    await waitForMicrotasks();
    // 还有空闲槽位，但独占任务必须等用户请求结束。
    expect(events).toEqual(["start:user"]);
    expect(scheduler.runningCount).toBe(1);

    userWork.resolve("fixed");
    await user.promise;
    await expect(learning.promise).resolves.toBe("learned");
    expect(events).toEqual(["start:user", "start:learning"]);
  });

  it("独占任务运行期间不派发其他后台任务", async () => {
    const scheduler = new AiRequestScheduler(2);
    const learningWork = deferred<string>();
    const events: string[] = [];

    const learning = scheduler.schedule({
      scope: context("workspace", "style-analysis"),
      priority: "background",
      exclusive: true,
      run: async () => {
        events.push("start:learning");
        return learningWork.promise;
      },
    });
    await waitForMicrotasks();

    const distill = scheduler.schedule({
      scope: context("doc.md", "distill"),
      priority: "background",
      run: async () => {
        events.push("start:distill");
        return "distilled";
      },
    });
    await waitForMicrotasks();
    expect(events).toEqual(["start:learning"]);

    learningWork.resolve("learned");
    await learning.promise;
    await expect(distill.promise).resolves.toBe("distilled");
    expect(events).toEqual(["start:learning", "start:distill"]);
  });

  it("U-SC-4: 随机交错下独占任务从不与任何其他任务同时运行", async () => {
    // 固定种子的线性同余发生器，保证用例可复现。
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const scheduler = new AiRequestScheduler(2);
    const affinities = [
      createLocalAffinityKey("lite", "gec"),
      createLocalAffinityKey("lite", "completion"),
      null,
    ];
    const running = new Set<string>();
    let violations = 0;
    const settled: Promise<unknown>[] = [];

    for (let index = 0; index < 1000; index += 1) {
      const exclusive = random() < 0.3;
      const id = `${exclusive ? "x" : "u"}-${index}`;
      const work = deferred<string>();
      const scheduled = scheduler.schedule({
        scope: context(`doc-${index}.md`, exclusive ? "style-analysis" : "gec"),
        priority: exclusive ? "background" : random() < 0.5 ? "urgent" : "normal",
        exclusive,
        affinityKey: exclusive
          ? createLocalAffinityKey("standard", "none")
          : affinities[Math.floor(random() * affinities.length)],
        run: async (runtime) => {
          running.add(id);
          const othersRunning = [...running].filter((other) => other !== id);
          const exclusiveConflict =
            othersRunning.length > 0 &&
            (exclusive || othersRunning.some((other) => other.startsWith("x-")));
          if (exclusiveConflict) {
            violations += 1;
          }
          runtime.signal.addEventListener("abort", () => running.delete(id), { once: true });
          try {
            return await work.promise;
          } finally {
            running.delete(id);
          }
        },
      });
      settled.push(scheduled.promise.catch(() => undefined));
      if (random() < 0.6) {
        await waitForMicrotasks();
        work.resolve(id);
      } else {
        queueMicrotask(() => work.resolve(id));
      }
    }

    await Promise.all(settled);
    expect(violations).toBe(0);
    expect(scheduler.runningCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });
});
