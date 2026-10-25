import { describe, expect, it, vi } from "vitest";
import {
  AnthropicClient,
  createModelClient,
  GoogleClient,
  LocalSlmClient,
  OpenAIClient,
  type AiSettings,
  type LocalInferenceRequest,
} from "../src/index.ts";

const mockBridge = async () => "ok";

describe("adapters: 多协议 ModelClient 适配器与工厂", () => {
  it("OpenAIClient 适配器正确构造 OpenAI Chat Completions 请求并提取响应", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: "这是续写内容。" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new OpenAIClient(
      {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test-123",
      },
      { fetchImpl: mockFetch },
    );

    const res = await client.generate({
      instruction: "System instructions",
      prompt: "User prompt",
      temperature: 0.5,
      maxTokens: 100,
      stopSequences: ["\n"],
    });

    expect(res.text).toBe("这是续写内容。");
    expect(res.finishReason).toBe("stop");
    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedHeaders.Authorization).toBe("Bearer sk-test-123");
    expect(capturedBody).toMatchObject({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: "User prompt" },
      ],
      temperature: 0.5,
      max_tokens: 100,
      stop: ["\n"],
    });
  });

  it("OpenAIClient 支持自定义 Base URL（如 DeepSeek 与 Ollama 且免 Key）", async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined(); // 本地 Ollama 未传 Key 时不发 Authorization 头
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ollama 回复" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new OpenAIClient(
      {
        baseUrl: "http://localhost:11434/v1",
        model: "qwen3:0.6b",
        apiKey: "",
      },
      { fetchImpl: mockFetch },
    );

    const res = await client.generate({ prompt: "ping" });
    expect(res.text).toBe("Ollama 回复");
  });

  it("AnthropicClient 注入必选版本号与免 CORS 头", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Claude 回复" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new AnthropicClient(
      {
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5",
        apiKey: "sk-ant-test",
      },
      { fetchImpl: mockFetch },
    );

    const res = await client.generate({
      instruction: "System text",
      prompt: "User text",
      maxTokens: 120,
    });

    expect(res.text).toBe("Claude 回复");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedHeaders["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test");
    expect(capturedBody.system).toBe("System text");
    expect(capturedBody.max_tokens).toBe(120);
  });

  it("GoogleClient 正确映射 systemInstruction 并提取纯文本输出", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [{ thought: true, text: "正在思考..." }, { text: "Gemini 输出内容" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const client = new GoogleClient(
      {
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-2.5-flash",
        apiKey: "AIzaTestKey",
      },
      { fetchImpl: mockFetch },
    );

    const res = await client.generate({
      instruction: "Gemini system",
      prompt: "Gemini prompt",
    });

    expect(res.text).toBe("Gemini 输出内容"); // thought: true 自动被过滤
    expect(capturedUrl).toContain("/v1beta/models/gemini-2.5-flash:generateContent");
    expect(capturedHeaders["x-goog-api-key"]).toBe("AIzaTestKey");
    expect(capturedBody.systemInstruction).toEqual({
      parts: [{ text: "Gemini system" }],
    });
  });

  it("LocalSlmClient 支持 Lite 裸 FIM 与 Standard ChatML 对话", async () => {
    const bridgeCalls: LocalInferenceRequest[] = [];
    const localBridge = async (req: LocalInferenceRequest) => {
      bridgeCalls.push(req);
      return req.rawPrompt ? " FIM 续写" : '[[0, 2, "测试", "正确"]]';
    };

    const client = new LocalSlmClient("md-editor-writer-lite", localBridge);

    // 1. Lite FIM
    const fimRes = await client.generate({
      prompt: "ignore",
      rawCompletion: { prompt: "<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>" },
      maxTokens: 64,
      task: "completion",
    });
    expect(fimRes.text).toBe(" FIM 续写");
    expect(bridgeCalls[0]?.rawPrompt).toBe("<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>");
    expect(bridgeCalls[0]?.messages).toBeUndefined();

    // 2. ChatML GEC
    const gecRes = await client.generate({
      instruction: "Sys",
      prompt: "待检",
      outputFormat: { kind: "gbnf-grammar", grammar: "root ::= []" },
      task: "gec",
    });
    expect(gecRes.text).toBe('[[0, 2, "测试", "正确"]]');
    expect(bridgeCalls[1]?.messages).toEqual([
      { role: "system", content: "Sys" },
      { role: "user", content: "待检" },
    ]);
    expect(bridgeCalls[1]?.grammar).toBe("root ::= []");
    expect(bridgeCalls[1]?.disableThinking).toBe(true);
  });

  it("createModelClient 工厂根据当前 provider 装配对应实例", () => {
    const baseSettings: AiSettings = {
      enabled: true,
      provider: "openai",
      features: { continuation: true, editing: true },
      endpoints: {
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "k1" },
        anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-3", apiKey: "k2" },
        google: {
          baseUrl: "https://generativelanguage.googleapis.com",
          model: "gemini",
          apiKey: "k3",
        },
      },
      localModel: {
        enabled: true,
        modelId: "md-editor-writer-standard",
        version: "v1.4.0",
        status: "available",
        downloadedBytes: 10,
        totalBytes: 10,
        error: null,
      },
    };

    expect(createModelClient(baseSettings)).toBeInstanceOf(OpenAIClient);
    expect(createModelClient({ ...baseSettings, provider: "anthropic" })).toBeInstanceOf(
      AnthropicClient,
    );
    expect(createModelClient({ ...baseSettings, provider: "google" })).toBeInstanceOf(GoogleClient);

    expect(
      createModelClient({ ...baseSettings, provider: "local" }, { localBridge: mockBridge }),
    ).toBeInstanceOf(LocalSlmClient);
  });
});
