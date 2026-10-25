import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAiWritingService,
  DEFAULT_AI_SETTINGS,
  type AiContextSnapshot,
  type AiSettings,
  type ModelClient,
} from "../src/index.ts";

describe("AiWritingService: App Harness 编排服务", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const snapshot: AiContextSnapshot = {
    before: "# 日记\n\n今天天气很好，但是我想出去玩。",
    after: "明天继续。",
    selectedText: "今天天气很好，但是我想出去玩。",
    mode: "wysiwyg",
    document: { title: "日记", filePath: "/notes/diary.md" },
  };

  it("checkReadiness 正常验证前置约束", () => {
    const service = createAiWritingService({ allowLocal: true });
    expect(service.checkReadiness({ ...DEFAULT_AI_SETTINGS, enabled: false })).toBe(
      "请先在设置中开启 AI 功能。",
    );
  });

  it("continueWriting 执行续写、剥离思维链并保留必要格式", async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      text: "<think>推演续写</think>然后我们一起去吃晚餐。",
      latencyMs: 20,
    });
    const resolveClient = () => ({
      providerId: "openai" as const,
      modelId: "gpt-4.1-mini",
      generate: generateSpy,
    });

    const service = createAiWritingService({
      allowLocal: true,
    });
    // 注入自定义 client
    (service as unknown as { resolveClient: typeof resolveClient }).resolveClient = resolveClient;

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: {
        continuation: true,
        editing: true,
      },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const result = await service.continueWriting(settings, snapshot, { isGhostText: true });
    expect(result.hasContinuation).toBe(true);
    expect(result.continuation).toBe("然后我们一起去吃晚餐。");
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it("fixGrammar 执行语法修复并按四重防御锚点对齐", async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      text: '[[7, 9, "但是", "所以"]]',
      latencyMs: 10,
    });
    const resolveClient = () => ({
      providerId: "openai" as const,
      modelId: "gpt-4.1-mini",
      generate: generateSpy,
    });

    const service = createAiWritingService({ allowLocal: true });
    (service as unknown as { resolveClient: typeof resolveClient }).resolveClient = resolveClient;

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: {
        continuation: true,
        editing: true,
      },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const result = await service.fixGrammar(settings, snapshot);
    expect(result.hasEdit).toBe(true);
    expect(result.edit).toMatchObject({
      original: "但是",
      replacement: "所以",
      utf16From: 7,
      utf16To: 9,
    });
  });

  it("testConnection 成功时返回延迟信息，失败时捕获错误", async () => {
    const okClient: ModelClient = {
      providerId: "openai",
      modelId: "gpt-4",
      generate: vi.fn().mockResolvedValue({ text: "OK", latencyMs: 38 }),
    };
    const failClient: ModelClient = {
      providerId: "openai",
      modelId: "gpt-4",
      generate: vi.fn().mockRejectedValue(new Error("API Key 无效")),
    };

    const serviceOk = createAiWritingService({ allowLocal: true });
    (serviceOk as unknown as { resolveClient: () => ModelClient }).resolveClient = () => okClient;

    const serviceFail = createAiWritingService({ allowLocal: true });
    (serviceFail as unknown as { resolveClient: () => ModelClient }).resolveClient = () =>
      failClient;

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: {
        continuation: true,
        editing: true,
      },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const okRes = await serviceOk.testConnection(settings);
    expect(okRes.ok).toBe(true);
    expect(okRes.message).toContain("38 ms");

    const failRes = await serviceFail.testConnection(settings);
    expect(failRes.ok).toBe(false);
    expect(failRes.message).toBe("API Key 无效");
  });

  it("distillDocument 与 scheduleDistillation 正常调度", async () => {
    const distillClient: ModelClient = {
      providerId: "openai",
      modelId: "gpt-4",
      generate: vi.fn().mockResolvedValue({ text: "主题：测试文档概要", latencyMs: 12 }),
    };

    const service = createAiWritingService({ allowLocal: true });
    (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () =>
      distillClient;

    const settings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      features: {
        continuation: true,
        editing: true,
      },
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4", apiKey: "sk-test" },
      },
    };

    const markdown =
      "# Title\n\nThis is a test content that is long enough for distillation testing.";
    const result = await service.distillDocument(settings, { markdown });
    expect(result.isDistilled).toBe(true);
    expect(result.topic).toBe("主题：测试文档概要");
  });
});
