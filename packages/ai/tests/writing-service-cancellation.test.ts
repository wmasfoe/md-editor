import { describe, expect, it, vi } from "vitest";

import {
  createAiWritingService,
  DEFAULT_AI_SETTINGS,
  type AiContextSnapshot,
  type AiSettings,
  type ModelClient,
} from "../src/index.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const activeSettings: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  features: {
    ...DEFAULT_AI_SETTINGS.features,
    continuation: true,
    editing: true,
  },
  provider: "openai",
  endpoints: {
    ...DEFAULT_AI_SETTINGS.endpoints,
    openai: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-test-key",
    },
  },
};

describe("AiWritingService 请求抢占与生命周期取消", () => {
  it("连续快速发起两次 continueWriting 时，新请求能自动抢占旧请求，旧请求以 AbortError 中止", async () => {
    const firstRequest = deferred<{ text: string }>();
    const generateFn = vi
      .fn()
      .mockImplementationOnce(async () => firstRequest.promise)
      .mockImplementationOnce(async () => ({ text: "新内容" }));

    const mockClient: ModelClient = {
      providerId: "openai",
      modelId: "gpt-4o",
      generate: generateFn,
    };

    const service = createAiWritingService({
      allowLocal: true,
    });
    (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => mockClient;

    const snapshot: AiContextSnapshot = {
      before: "这是一段测试文字",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
      document: {
        filePath: "/docs/test.md",
      },
    };

    const promise1 = service.continueWriting(activeSettings, snapshot);
    // 立即发起针对同一文档的第二次续写
    const promise2 = service.continueWriting(activeSettings, snapshot);

    // 第一个请求应被 scheduler 取消为 AbortError
    await expect(promise1).rejects.toMatchObject({ name: "AbortError" });

    // 第二个请求成功返回
    const result2 = await promise2;
    expect(result2.hasContinuation).toBe(true);
    expect(result2.continuation).toBe("新内容");
  });

  it("外部 signal 提前触发 abort 时，能够立即中止且不调用生成", async () => {
    const generateFn = vi.fn();
    const mockClient: ModelClient = {
      providerId: "openai",
      modelId: "gpt-4o",
      generate: generateFn,
    };

    const service = createAiWritingService({
      allowLocal: true,
    });
    (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => mockClient;

    const snapshot: AiContextSnapshot = {
      before: "测试",
      after: "",
      selectedText: "",
      mode: "wysiwyg",
      document: {
        filePath: "/docs/test.md",
      },
    };

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      service.continueWriting(activeSettings, snapshot, {
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(generateFn).not.toHaveBeenCalled();
  });
});
