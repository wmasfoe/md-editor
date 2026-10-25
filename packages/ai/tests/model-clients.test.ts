import { describe, expect, it, vi } from "vitest";
import {
  AnthropicClient,
  clearGlobalUnsupportedParamsCache,
  createModelClient,
  GoogleClient,
  isEarlyOpenAiReasoningModel,
  isOpenAiReasoningModel,
  LocalSlmClient,
  logLlmError,
  logLlmRequest,
  logLlmRetry,
  logLlmSuccess,
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

  describe("OpenAI 推理模型适配与自愈", () => {
    it("正确识别 OpenAI o 系列推理模型与早期模型", () => {
      expect(isOpenAiReasoningModel("o1")).toBe(true);
      expect(isOpenAiReasoningModel("o1-mini")).toBe(true);
      expect(isOpenAiReasoningModel("o1-preview")).toBe(true);
      expect(isOpenAiReasoningModel("o3-mini")).toBe(true);
      expect(isOpenAiReasoningModel("o3")).toBe(true);
      expect(isOpenAiReasoningModel("o4-preview")).toBe(true);
      expect(isOpenAiReasoningModel("openai/o1-mini")).toBe(true);

      expect(isOpenAiReasoningModel("gpt-4o")).toBe(false);
      expect(isOpenAiReasoningModel("gpt-4.1-mini")).toBe(false);
      expect(isOpenAiReasoningModel("deepseek-chat")).toBe(false);
      expect(isOpenAiReasoningModel("qwen3:0.6b")).toBe(false);

      expect(isEarlyOpenAiReasoningModel("o1-mini")).toBe(true);
      expect(isEarlyOpenAiReasoningModel("o1-preview")).toBe(true);
      expect(isEarlyOpenAiReasoningModel("o1")).toBe(false);
      expect(isEarlyOpenAiReasoningModel("o3-mini")).toBe(false);
    });

    it("推理模型 (o3-mini) 自动使用 max_completion_tokens 并剔除 temperature，使用 developer 角色", async () => {
      let capturedBody: Record<string, unknown> = {};

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "o3-mini 思考并完成续写" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new OpenAIClient(
        {
          baseUrl: "https://api.openai.com/v1",
          model: "o3-mini",
          apiKey: "sk-o3-test",
        },
        { fetchImpl: mockFetch },
      );

      const res = await client.generate({
        instruction: "保持简洁。",
        prompt: "续写这首诗歌",
        temperature: 0.7,
        maxTokens: 256,
      });

      expect(res.text).toBe("o3-mini 思考并完成续写");
      expect(capturedBody.model).toBe("o3-mini");
      // 推理模型严格不应传 temperature
      expect(capturedBody.temperature).toBeUndefined();
      // 推理模型不使用 max_tokens，使用 max_completion_tokens，且预算至少 1024
      expect(capturedBody.max_tokens).toBeUndefined();
      expect(capturedBody.max_completion_tokens).toBe(1024);
      // 使用 developer 角色
      expect(capturedBody.messages).toEqual([
        { role: "developer", content: "保持简洁。" },
        { role: "user", content: "续写这首诗歌" },
      ]);
    });

    it("早期推理模型 (o1-mini) 将 instruction 整合入 user 消息避免角色报错", async () => {
      let capturedBody: Record<string, unknown> = {};

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "o1-mini 续写" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new OpenAIClient(
        {
          baseUrl: "https://api.openai.com/v1",
          model: "o1-mini",
          apiKey: "sk-o1-mini-test",
        },
        { fetchImpl: mockFetch },
      );

      const res = await client.generate({
        instruction: "修补语法错误。",
        prompt: "他走去学校。",
      });

      expect(res.text).toBe("o1-mini 续写");
      expect(capturedBody.messages).toEqual([
        {
          role: "user",
          content: "[Instruction]\n修补语法错误。\n\n[Content]\n他走去学校。",
        },
      ]);
    });

    it("当遇到 'max_tokens is not supported with this model. Use max_completion_tokens instead' 时自动自愈重试", async () => {
      let attemptCount = 0;
      const capturedBodies: Array<Record<string, unknown>> = [];

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        attemptCount++;
        const body = JSON.parse(init?.body as string) as Record<string, unknown>;
        capturedBodies.push(body);

        if (attemptCount === 1) {
          // 首次请求模拟 OpenAI 报错 400
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
                type: "invalid_request_error",
                param: "max_tokens",
                code: "unsupported_parameter",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // 第二次重试自愈成功
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "自愈重试成功响应" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new OpenAIClient(
        {
          baseUrl: "https://api.openai.com/v1",
          model: "custom-reasoning-model",
          apiKey: "sk-test",
        },
        { fetchImpl: mockFetch },
      );

      const res = await client.generate({
        instruction: "提示词",
        prompt: "测试文本",
        temperature: 0.3,
        maxTokens: 256,
      });

      expect(res.text).toBe("自愈重试成功响应");
      expect(attemptCount).toBe(2);

      // 首次发出的请求包含 max_tokens 与 temperature
      expect(capturedBodies[0].max_tokens).toBe(256);
      expect(capturedBodies[0].temperature).toBe(0.3);

      // 自愈后第二次发出的请求：max_tokens 与 temperature 已剔除，转为 max_completion_tokens
      expect(capturedBodies[1].max_tokens).toBeUndefined();
      expect(capturedBodies[1].temperature).toBeUndefined();
      expect(capturedBodies[1].max_completion_tokens).toBe(1024);
    });

    it("gpt-5 系列模型 (gpt-5.4-nano) 预置识别为现代推理模型，首发即使用 max_completion_tokens 且不发 stop/temperature", async () => {
      let capturedBody: Record<string, unknown> = {};
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "gpt-5 续写" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new OpenAIClient(
        {
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.4-nano",
          apiKey: "sk-test",
        },
        { fetchImpl: mockFetch },
      );

      const res = await client.generate({
        instruction: "系统指令",
        prompt: "用户输入",
        temperature: 0.3,
        stopSequences: ["\n"],
        maxTokens: 256,
      });

      expect(res.text).toBe("gpt-5 续写");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // 验证不传易引发 400 的参数
      expect(capturedBody.max_tokens).toBeUndefined();
      expect(capturedBody.temperature).toBeUndefined();
      expect(capturedBody.stop).toBeUndefined();
      expect(capturedBody.max_completion_tokens).toBe(1024);
      expect((capturedBody.messages as Array<{ role: string }>)[0].role).toBe("developer");
    });

    it("对于未在正则中的未知模型，遇到 'stop' 不支持时自动自愈，且后续新建 Client 实例通过全局缓存持久记忆跳过", async () => {
      clearGlobalUnsupportedParamsCache();
      let attemptCount = 0;
      const capturedBodies: Array<Record<string, unknown>> = [];

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        attemptCount++;
        const body = JSON.parse(init?.body as string) as Record<string, unknown>;
        capturedBodies.push(body);

        if (attemptCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message: "Unsupported parameter: 'stop' is not supported with this model.",
                type: "invalid_request_error",
                param: "stop",
                code: "unsupported_parameter",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "自愈成功响应" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client1 = new OpenAIClient(
        {
          baseUrl: "https://api.my-custom-proxy.com/v1",
          model: "custom-nano-variant",
          apiKey: "sk-test",
        },
        { fetchImpl: mockFetch },
      );

      const res = await client1.generate({
        instruction: "提示词",
        prompt: "测试文本",
        stopSequences: ["\n"],
      });

      expect(res.text).toBe("自愈成功响应");
      expect(attemptCount).toBe(2);
      expect(capturedBodies[0].stop).toEqual(["\n"]);
      expect(capturedBodies[1].stop).toBeUndefined();
      // 同步自愈：stop 不支持时，自动将 max_tokens 升级为 max_completion_tokens 并清除 temperature
      expect(capturedBodies[1].max_tokens).toBeUndefined();
      expect(capturedBodies[1].max_completion_tokens).toBe(1024);
      expect(capturedBodies[1].temperature).toBeUndefined();

      // 模拟 resolveClient：重新实例化一个新的 client2
      const client2 = new OpenAIClient(
        {
          baseUrl: "https://api.my-custom-proxy.com/v1",
          model: "custom-nano-variant",
          apiKey: "sk-test",
        },
        { fetchImpl: mockFetch },
      );

      await client2.generate({
        instruction: "提示词",
        prompt: "测试文本2",
        stopSequences: ["\n"],
      });

      // 验证 client2 从首发开始就不再携带 stop，不需要触发 400 重试
      expect(attemptCount).toBe(3);
      expect(capturedBodies[2].stop).toBeUndefined();
    });
  });

  describe("logger: 开发环境结构化日志", () => {
    it("logLlmRequest, logLlmSuccess, logLlmRetry, logLlmError 正常执行且不抛异常", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        logLlmRequest("OpenAI", "gpt-4o", { task: "completion", promptPreview: "test" });
        logLlmSuccess("OpenAI", "gpt-4o", { latencyMs: 100, textPreview: "res" });
        logLlmRetry("OpenAI", "gpt-4o", { attempt: 1, reason: "err" });
        logLlmError("OpenAI", "gpt-4o", { latencyMs: 50, error: "fail" });
      }).not.toThrow();

      debugSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
