import { describe, expect, it } from "vitest";
import type { AiCompletionContext, AiSettings } from "@md-editor/editor-core";
import {
  createOpenAiCompatibleRequestBody,
  getAiCompletionReadiness,
  parseAiWritingSuggestion
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
    status: "not-downloaded"
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
      localModel: { enabled: true, status: "not-downloaded" }
    })).toBe("本地模型尚未下载，当前还不能续写。");
  });

  it("builds a non-streaming OpenAI-compatible chat completion request", () => {
    expect(createOpenAiCompatibleRequestBody(baseSettings, context)).toMatchObject({
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
});
