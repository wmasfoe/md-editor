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
});
