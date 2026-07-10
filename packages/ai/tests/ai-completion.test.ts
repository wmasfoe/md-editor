import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiCompletionContext, AiSettings } from "../src/index.ts";
import {
  createAiContextCacheSeed,
  createAiPromptContext,
  createOpenAiCompatibleRequestBody,
  getAiCompletionReadiness,
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
    ).toBe("本地模型尚未下载，当前还不能续写。");
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
          continuation: " and keeps writing.",
          edit: {
            original: "This are wrong",
            replacement: "This is wrong",
            reason: "subject verb agreement",
          },
        }),
      ),
    ).toEqual({
      continuation: "and keeps writing.",
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
          continuation: "\n\n### 需求分析\n\n1. 审核触发条件",
          edit: null,
        }),
      ),
    ).toEqual({
      continuation: "\n\n### 需求分析\n\n1. 审核触发条件",
    });
  });

  it("treats an empty model response as no suggestion instead of a user-facing error", async () => {
    const fetchImpl = async () =>
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

    await expect(requestAiContinuation(baseSettings, context, { fetchImpl })).resolves.toEqual({});
  });

  it("routes local completion through the injected local model command", async () => {
    const localInvokeCalls: Array<{
      readonly command: string;
      readonly args?: Record<string, unknown>;
    }> = [];
    const localInvokeImpl = async (command: string, args?: Record<string, unknown>) => {
      localInvokeCalls.push({ command, args });
      return JSON.stringify({ continuation: "本地续写。", edit: null });
    };

    await expect(
      requestAiContinuation(localReadySettings(), context, { localInvokeImpl }),
    ).resolves.toEqual({ continuation: "本地续写。" });

    expect(localInvokeCalls).toEqual([
      {
        command: "request_local_ai_continuation",
        args: {
          context,
          options: {
            modelId: "md-editor-writer-small-v1",
            maxTokens: 220,
          },
        },
      },
    ]);
  });

  it("requires platform injection for local completion instead of importing runtime APIs", async () => {
    await expect(requestAiContinuation(localReadySettings(), context)).rejects.toThrow(
      "本地模型请求需要由平台注入 localInvokeImpl。",
    );
  });

  it("times out stalled local completion requests", async () => {
    vi.useFakeTimers();
    const localInvokeImpl = () => new Promise<unknown>(() => {});

    const request = requestAiContinuation(localReadySettings(), context, {
      localInvokeImpl,
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
});
