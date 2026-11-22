/**
 * U-LOADER：可选重依赖门闸的契约。
 *
 * 这些断言锁住三件不能退让的事：
 * 1. 未就绪时调用方拿到 `undefined`（必须走降级，不得静默放行）；
 * 2. 就绪后订阅者只收到一次通知，且 `getOptionalModule` 立刻可用；
 * 3. 加载失败不进"永久失败"状态（离线/瞬时错误后可重试）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getOptionalModule,
  onOptionalModuleReady,
  preloadOptionalModule,
  resetOptionalModuleCache,
  type OptionalModuleKey,
} from "../src/module-loader";

/** 测试用模块 key：加载器本身对 key 是开放的，只要求稳定字符串。 */
const DEMO_KEY = "turndown" as OptionalModuleKey;

afterEach(() => {
  resetOptionalModuleCache();
});

describe("optional module loader", () => {
  it("未就绪时返回 undefined，就绪后返回值并只通知一次", async () => {
    let resolveImport: ((value: { marker: string }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ marker: string }>((resolve) => {
          resolveImport = resolve;
        }),
    );

    const listener = vi.fn();
    const unsubscribe = onOptionalModuleReady(listener);

    void preloadOptionalModule(DEMO_KEY, importer);
    expect(getOptionalModule(DEMO_KEY)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();

    resolveImport?.({ marker: "ready" });
    await vi.waitFor(() => expect(getOptionalModule(DEMO_KEY)).toEqual({ marker: "ready" }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    // 幂等：再次预加载既不再调用 importer，也不再重复通知。
    await preloadOptionalModule(DEMO_KEY, importer);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("加载失败不缓存为永久失败，可重试", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    void preloadOptionalModule("retry", failing);
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    // 等失败落定（pending 条目被清除），否则第二次调用会复用到旧 Promise。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const retrying = vi.fn(() => Promise.resolve({ ok: true }));
    void preloadOptionalModule("retry", retrying);
    await vi.waitFor(() => expect(getOptionalModule("retry")).toEqual({ ok: true }));
    expect(retrying).toHaveBeenCalledTimes(1);
  });
});
