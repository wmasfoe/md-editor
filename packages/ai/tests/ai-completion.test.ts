import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiCompletionContext, AiSettings } from "../src/index.ts";
import {
  BUILTIN_LOCAL_MODELS,
  createAiContextCacheSeed,
  createAiPromptContext,
  createOpenAiCompatibleRequestBody,
  getAiCompletionReadiness,
  normalizeLocalAiModelSettings,
  parseAiWritingSuggestion,
  requestAiContinuation,
} from "../src/index.ts";

const baseSettings: AiSettings = {
  enabled: true,
  provider: "openai-compatible",
  features: {
    continuation: true,
    editing: true,
  },
  openAiCompatible: {
    baseUrl: "https://api.example.test/v1",
    model: "writer-model",
    apiKey: "local-key",
  },
  localModel: {
    enabled: false,
    modelId: "md-editor-writer-small-v1",
    version: null,
    status: "not-downloaded",
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
  },
};

const context: AiCompletionContext = {
  before: "# Title\n\nThis is the start",
  after: "This is the next paragraph",
  selectedText: "",
  mode: "wysiwyg",
};

const emptyOpenAiResponse = async () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ continuation: "", edit: null }),
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

const stalledLocalInvoke = () => new Promise<unknown>(() => {});

function localReadySettings(): AiSettings {
  return {
    ...baseSettings,
    provider: "local",
    localModel: {
      ...baseSettings.localModel,
      enabled: true,
      version: "2026.06.25",
      status: "available",
      downloadedBytes: 1024,
      totalBytes: 1024,
    },
  };
}

describe("AI completion settings", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires explicit AI enablement before completion", () => {
    expect(getAiCompletionReadiness({ ...baseSettings, enabled: false })).toBe(
      "请先在设置中开启 AI 功能。",
    );
  });

  it("requires at least one AI writing feature", () => {
    expect(
      getAiCompletionReadiness({
        ...baseSettings,
        features: { continuation: false, editing: false },
      }),
    ).toBe("请先开启 AI 续写或语法标点修复。");
  });

  it("requires a downloaded local model before local completion", () => {
    expect(
      getAiCompletionReadiness({
        ...baseSettings,
        provider: "local",
        localModel: {
          ...baseSettings.localModel,
          enabled: true,
          status: "not-downloaded",
        },
      }),
    ).toBe("本地模型尚未下载，当前还不能使用 AI。");
  });

  it("checks intent-specific feature readiness", () => {
    expect(
      getAiCompletionReadiness(
        {
          ...baseSettings,
          features: { continuation: false, editing: true },
        },
        "continuation",
      ),
    ).toBe("请先在设置中开启 AI 续写功能。");

    expect(
      getAiCompletionReadiness(
        {
          ...baseSettings,
          features: { continuation: true, editing: false },
        },
        "editing",
      ),
    ).toBe("请先在设置中开启语法标点修复功能。");
  });

  it("builds a non-streaming OpenAI-compatible chat completion request", () => {
    const requestBody = createOpenAiCompatibleRequestBody(baseSettings, context);

    expect(requestBody).toMatchObject({
      model: "writer-model",
      stream: false,
      messages: [
        { role: "system" },
        {
          role: "user",
          content: expect.stringContaining("【光标前】"),
        },
      ],
    });
    expect(requestBody).not.toHaveProperty("extra_body");
  });

  it("normalizes pure context snapshots before prompt creation", () => {
    const snapshot = {
      ...context,
      before: `${"x".repeat(3_100)}before`,
      after: `after${"y".repeat(3_100)}`,
      cursor: {
        position: 42,
        selection: { from: 40, to: 42 },
      },
      document: {
        filePath: "/tmp/post.md",
      },
    };

    expect(createAiPromptContext(snapshot)).toEqual({
      before: `${"x".repeat(2_994)}before`,
      selectedText: "",
      after: `after${"y".repeat(2_995)}`,
      mode: "wysiwyg",
      filePath: "/tmp/post.md",
    });
    const cacheSeed = createAiContextCacheSeed(snapshot);
    expect(cacheSeed).toContain('"cursor":{"position":42,"selection":{"from":40,"to":42}}');
    expect(cacheSeed).toContain('"filePath":"/tmp/post.md"');
  });

  it("disables provider thinking for DeepSeek-compatible requests", () => {
    expect(
      createOpenAiCompatibleRequestBody(
        {
          ...baseSettings,
          provider: "deepseek",
          openAiCompatible: {
            ...baseSettings.openAiCompatible,
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
          },
        },
        context,
      ),
    ).toMatchObject({
      extra_body: {
        thinking: {
          type: "disabled",
        },
      },
    });
  });

  it("does not infer DeepSeek thinking controls from endpoint or model alone", () => {
    expect(
      createOpenAiCompatibleRequestBody(
        {
          ...baseSettings,
          provider: "openai-compatible",
          openAiCompatible: {
            ...baseSettings.openAiCompatible,
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
          },
        },
        context,
      ),
    ).not.toHaveProperty("extra_body");
  });

  it("parses structured continuation and edit suggestions from model JSON", () => {
    expect(
      parseAiWritingSuggestion(
        JSON.stringify({
          hasContinuation: true,
          continuation: " and keeps writing.",
          hasEdit: true,
          edit: {
            original: "This are wrong",
            replacement: "This is wrong",
            reason: "subject verb agreement",
          },
        }),
      ),
    ).toEqual({
      hasContinuation: true,
      continuation: "and keeps writing.",
      hasEdit: true,
      edit: {
        original: "This are wrong",
        replacement: "This is wrong",
        reason: "subject verb agreement",
      },
    });
  });

  it("preserves leading newlines in continuation so Markdown blocks keep their boundary", () => {
    expect(
      parseAiWritingSuggestion(
        JSON.stringify({
          hasContinuation: true,
          continuation: "\n\n### 需求分析\n\n1. 审核触发条件",
          hasEdit: false,
          edit: null,
        }),
      ),
    ).toEqual({
      hasContinuation: true,
      continuation: "\n\n### 需求分析\n\n1. 审核触发条件",
      hasEdit: false,
      edit: null,
    });
  });

  it("treats an empty model response as no suggestion instead of a user-facing error", async () => {
    await expect(
      requestAiContinuation(baseSettings, context, { fetchImpl: emptyOpenAiResponse }),
    ).resolves.toEqual({
      hasContinuation: false,
      hasEdit: false,
      edit: null,
    });
  });

  it("routes local completion through the injected local model command", async () => {
    const localInvokeCalls: Array<{
      readonly command: string;
      readonly args?: Record<string, unknown>;
    }> = [];
    const localInvokeImpl = async (command: string, args?: Record<string, unknown>) => {
      localInvokeCalls.push({ command, args });
      return JSON.stringify({
        hasContinuation: true,
        continuation: "本地续写。",
        hasEdit: false,
        edit: null,
      });
    };

    await expect(
      requestAiContinuation(localReadySettings(), context, { localInvokeImpl }),
    ).resolves.toEqual({
      hasContinuation: true,
      continuation: "本地续写。",
      hasEdit: false,
      edit: null,
    });

    expect(localInvokeCalls).toHaveLength(1);
    expect(localInvokeCalls[0].command).toBe("request_local_ai_continuation");
    expect(localInvokeCalls[0].args?.context).toEqual(context);
    expect(localInvokeCalls[0].args?.options).toMatchObject({
      modelId: "md-editor-writer-small-v1",
      maxTokens: 220,
      intent: "both",
    });
    expect((localInvokeCalls[0].args?.options as { prompt?: string })?.prompt).toContain(
      "<|task_gec_zh|>",
    );
  });

  it("handles SLM tuple JSON diff output for editing intent", async () => {
    const editContext = {
      ...context,
      selectedText: "今天天气很好，但是我想出去玩。",
    };

    const result = await requestAiContinuation(localReadySettings(), editContext, {
      localInvokeImpl: async () => '[[7, 9, "但是", "所以"]]',
      intent: "editing",
    });

    expect(result).toMatchObject({
      hasContinuation: false,
      hasEdit: true,
      edit: {
        original: "但是",
        replacement: "所以",
        start: 7,
        end: 9,
        utf16From: 7,
        utf16To: 9,
      },
    });
  });

  it("requires platform injection for local completion instead of importing runtime APIs", async () => {
    await expect(requestAiContinuation(localReadySettings(), context)).rejects.toThrow(
      "本地模型请求需要由平台注入 localInvokeImpl。",
    );
  });

  it("times out stalled local completion requests", async () => {
    vi.useFakeTimers();

    const request = requestAiContinuation(localReadySettings(), context, {
      localInvokeImpl: stalledLocalInvoke,
      timeoutMs: 1_000,
    });
    await Promise.all([
      expect(request).rejects.toThrow("AI 续写超时，请稍后重试。"),
      vi.advanceTimersByTimeAsync(1_000),
    ]);
  });

  it("does not start local completion when the caller already aborted", async () => {
    let localInvokeCalled = false;
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestAiContinuation(localReadySettings(), context, {
        signal: controller.signal,
        localInvokeImpl: async () => {
          localInvokeCalled = true;
          return JSON.stringify({ continuation: "不应该出现。", edit: null });
        },
      }),
    ).rejects.toThrow("AI 续写超时，请稍后重试。");

    expect(localInvokeCalled).toBe(false);
  });

  it("provides built-in local model descriptors for Lite, Standard, and Pro tier", () => {
    expect(BUILTIN_LOCAL_MODELS.map((m) => m.tier)).toEqual(["lite", "standard", "pro"]);
    expect(BUILTIN_LOCAL_MODELS.find((m) => m.tier === "pro")?.isAvailable).toBe(false);
    expect(BUILTIN_LOCAL_MODELS.find((m) => m.tier === "standard")?.isAvailable).toBe(true);

    const normalizedLegacy = normalizeLocalAiModelSettings({
      modelId: "md-editor-writer-small-v1",
      version: "v1.0.0",
      latestVersion: "v1.1.0",
      hasUpdate: true,
    });
    expect(normalizedLegacy.modelId).toBe("md-editor-writer-lite");
    expect(normalizedLegacy.latestVersion).toBe("v1.1.0");
    expect(normalizedLegacy.hasUpdate).toBe(true);
  });
});
