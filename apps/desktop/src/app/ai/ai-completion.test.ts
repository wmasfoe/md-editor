import { describe, expect, it } from "vitest";
import type { AiCompletionContext, AiSettings } from "@md-editor/editor-core";
import {
  createOpenAiCompatibleRequestBody,
  getAiCompletionReadiness,
  parseAiWritingSuggestion,
  requestAiContinuation
} from "./ai-completion";

const baseSettings: AiSettings = {
  enabled: true,
  provider: "openai-compatible",
  features: {
    continuation: true,
    editing: true
  },
  openAiCompatible: {
    baseUrl: "https://api.example.test/v1",
    model: "writer-model",
    apiKey: "local-key"
  },
  localModel: {
    enabled: false,
    modelId: "md-editor-writer-small-v1",
    version: null,
    status: "not-downloaded",
    downloadedBytes: 0,
    totalBytes: 0,
    error: null
  }
};

const context: AiCompletionContext = {
  before: "# Title\n\nThis is the start",
  after: "This is the next paragraph",
  selectedText: "",
  mode: "wysiwyg"
};

describe("AI completion settings", () => {
  it("requires explicit AI enablement before completion", () => {
    expect(getAiCompletionReadiness({ ...baseSettings, enabled: false })).toBe("请先在设置中开启 AI 功能。");
  });

  it("requires at least one AI writing feature", () => {
    expect(getAiCompletionReadiness({
      ...baseSettings,
      features: { continuation: false, editing: false }
    })).toBe("请先开启 AI 续写或语法标点修复。");
  });

  it("requires a downloaded local model before local completion", () => {
    expect(getAiCompletionReadiness({
      ...baseSettings,
      provider: "local",
      localModel: {
        ...baseSettings.localModel,
        enabled: true,
        status: "not-downloaded"
      }
    })).toBe("本地模型尚未下载，当前还不能续写。");
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
          content: expect.stringContaining("【光标前】")
        }
      ]
    });
    expect(requestBody).not.toHaveProperty("extra_body");
  });

  it("disables provider thinking for DeepSeek-compatible requests", () => {
    expect(createOpenAiCompatibleRequestBody({
      ...baseSettings,
      provider: "deepseek",
      openAiCompatible: {
        ...baseSettings.openAiCompatible,
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      }
    }, context)).toMatchObject({
      extra_body: {
        thinking: {
          type: "disabled"
        }
      }
    });
  });

  it("does not infer DeepSeek thinking controls from endpoint or model alone", () => {
    expect(createOpenAiCompatibleRequestBody({
      ...baseSettings,
      provider: "openai-compatible",
      openAiCompatible: {
        ...baseSettings.openAiCompatible,
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      }
    }, context)).not.toHaveProperty("extra_body");
  });

  it("parses structured continuation and edit suggestions from model JSON", () => {
    expect(parseAiWritingSuggestion(JSON.stringify({
      continuation: " and keeps writing.",
      edit: {
        original: "This are wrong",
        replacement: "This is wrong",
        reason: "subject verb agreement"
      }
    }))).toEqual({
      continuation: "and keeps writing.",
      edit: {
        original: "This are wrong",
        replacement: "This is wrong",
        reason: "subject verb agreement"
      }
    });
  });

  it("treats an empty model response as no suggestion instead of a user-facing error", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ continuation: "", edit: null })
            }
          }
        ]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    await expect(
      requestAiContinuation(baseSettings, context, { fetchImpl })
    ).resolves.toEqual({});
  });

  it("routes local completion through the desktop local model command", async () => {
    const localInvokeCalls: Array<{ readonly command: string; readonly args?: Record<string, unknown> }> = [];
    const localInvokeImpl = async (command: string, args?: Record<string, unknown>) => {
      localInvokeCalls.push({ command, args });
      return JSON.stringify({ continuation: "本地续写。", edit: null });
    };

    await expect(
      requestAiContinuation({
        ...baseSettings,
        provider: "local",
        localModel: {
          ...baseSettings.localModel,
          enabled: true,
          version: "2026.06.25",
          status: "available",
          downloadedBytes: 1024,
          totalBytes: 1024
        }
      }, context, { localInvokeImpl })
    ).resolves.toEqual({ continuation: "本地续写。" });

    expect(localInvokeCalls).toEqual([
      {
        command: "request_local_ai_continuation",
        args: {
          context,
          options: {
            modelId: "md-editor-writer-small-v1",
            maxTokens: 220
          }
        }
      }
    ]);
  });
});
