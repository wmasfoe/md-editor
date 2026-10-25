import { describe, expect, it } from "vitest";
import {
  applyAiUrlPreset,
  DEFAULT_AI_SETTINGS,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  getAiCompletionReadiness,
  isLoopbackHttpEndpoint,
  normalizeAiProvider,
  normalizeAiSettings,
  updateAiEndpoint,
  updateAiFeature,
  updateAiProvider,
} from "../src/index.ts";

describe("settings: 多协议配置归一化、预设与向后兼容迁移", () => {
  it("normalizeAiProvider 兼容旧版 provider 标识", () => {
    expect(normalizeAiProvider("deepseek")).toBe("openai");
    expect(normalizeAiProvider("openai-compatible")).toBe("openai");
    expect(normalizeAiProvider("ollama")).toBe("openai");
    expect(normalizeAiProvider("anthropic")).toBe("anthropic");
    expect(normalizeAiProvider("google")).toBe("google");
    expect(normalizeAiProvider("local", { allowLocal: true })).toBe("local");
    expect(normalizeAiProvider("local", { allowLocal: false })).toBe("openai");
  });

  it("isLoopbackHttpEndpoint 正确识别本地回环服务", () => {
    expect(isLoopbackHttpEndpoint("http://localhost:11434")).toBe(true);
    expect(isLoopbackHttpEndpoint("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLoopbackHttpEndpoint("http://[::1]:11434")).toBe(true);
    expect(isLoopbackHttpEndpoint("https://api.openai.com/v1")).toBe(false);
  });

  it("无缝迁移 Desktop 历史数据结构（含 openAiCompatible 嵌套与 deepseek 历史类型）", () => {
    const legacyDesktop = {
      enabled: true,
      provider: "deepseek",
      features: { continuation: true, editing: true },
      openAiCompatible: {
        baseUrl: "https://custom.deepseek.proxy/v1",
        model: "deepseek-chat",
        apiKey: "sk-legacy-key",
      },
      localModel: {
        enabled: true,
        modelId: "md-editor-writer-small-v1",
        version: "v1.0.0",
        status: "available",
      },
    };

    const normalized = normalizeAiSettings(legacyDesktop, { allowLocal: true });
    expect(normalized.provider).toBe("openai");
    expect(normalized.endpoints.openai.baseUrl).toBe("https://custom.deepseek.proxy/v1");
    expect(normalized.endpoints.openai.model).toBe("deepseek-chat");
    expect(normalized.endpoints.openai.apiKey).toBe("sk-legacy-key");
    expect(normalized.localModel.modelId).toBe("md-editor-writer-lite"); // 旧版 small-v1 自动升级为 lite
  });

  it("无缝迁移 Web 历史扁平数据结构（baseUrl / model / apiKey 在顶层）", () => {
    const legacyWeb = {
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      model: "custom-model",
      apiKey: "sk-web-key",
    };

    const normalized = normalizeAiSettings(legacyWeb, { allowLocal: false });
    expect(normalized.provider).toBe("openai");
    expect(normalized.endpoints.openai.baseUrl).toBe("https://api.example.com/v1");
    expect(normalized.endpoints.openai.model).toBe("custom-model");
    expect(normalized.endpoints.openai.apiKey).toBe("sk-web-key");
    expect(normalized.features.continuation).toBe(true);
  });

  it("applyAiUrlPreset 一键填充预设且当模型名为空或预设默认值时自动联动切换推荐模型", () => {
    let settings = DEFAULT_AI_SETTINGS;

    // 1. 切换为 DeepSeek 预设
    settings = applyAiUrlPreset(settings, "deepseek");
    expect(settings.provider).toBe("openai");
    expect(settings.endpoints.openai.baseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    expect(settings.endpoints.openai.model).toBe("deepseek-chat");

    // 2. 切换为 Anthropic 预设
    settings = applyAiUrlPreset(settings, "anthropic");
    expect(settings.provider).toBe("anthropic");
    expect(settings.endpoints.anthropic.baseUrl).toContain("anthropic.com");
    expect(settings.endpoints.anthropic.model).toBe("claude-sonnet-4-5");

    // 3. 用户自定义了模型名（如 claude-opus-4），再切换其他预设时不强制冲掉非默认模型
    settings = updateAiEndpoint(settings, "anthropic", { model: "my-custom-fine-tuned" });
    settings = applyAiUrlPreset(settings, "anthropic");
    expect(settings.endpoints.anthropic.model).toBe("my-custom-fine-tuned");
  });

  it("getAiCompletionReadiness 针对不同协议、任务和本地模型准确返回就绪提示", () => {
    // 1. 未启用
    expect(getAiCompletionReadiness({ ...DEFAULT_AI_SETTINGS, enabled: false })).toBe(
      "请先在设置中开启 AI 功能。",
    );

    // 2. 特性全关
    expect(
      getAiCompletionReadiness({
        ...DEFAULT_AI_SETTINGS,
        features: { continuation: false, editing: false },
      }),
    ).toBe("请先开启 AI 续写或语法标点修复。");

    // 3. 云端缺少 Key（非回环）
    const missingKey = {
      ...DEFAULT_AI_SETTINGS,
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: DEFAULT_OPENAI_BASE_URL, model: "gpt-4", apiKey: "" },
      },
    };
    expect(getAiCompletionReadiness(missingKey)).toBe("请先配置 API Key。");

    // 4. 云端为本地 Ollama 回环时免 Key 通过
    const loopbackOllama = {
      ...DEFAULT_AI_SETTINGS,
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: DEFAULT_OLLAMA_BASE_URL, model: "qwen3:0.6b", apiKey: "" },
      },
    };
    expect(getAiCompletionReadiness(loopbackOllama)).toBeNull();

    // 5. 本地模型未下载
    const localNotDownloaded = {
      ...DEFAULT_AI_SETTINGS,
      provider: "local" as const,
      localModel: {
        ...DEFAULT_AI_SETTINGS.localModel,
        enabled: true,
        status: "not-downloaded" as const,
      },
    };
    expect(getAiCompletionReadiness(localNotDownloaded, "both", { allowLocal: true })).toBe(
      "本地模型尚未下载，当前还不能使用 AI。",
    );

    // 6. 不允许本地模型的宿主平台（如 Web / uTools）
    expect(getAiCompletionReadiness(localNotDownloaded, "both", { allowLocal: false })).toBe(
      "当前运行环境不支持离线本地模型，请切换至云端协议或使用原生桌面端。",
    );
  });

  it("不可变更新辅助函数正常工作", () => {
    const s1 = updateAiProvider(DEFAULT_AI_SETTINGS, "google");
    expect(s1.provider).toBe("google");

    const s2 = updateAiEndpoint(s1, "google", { apiKey: "AIza-new" });
    expect(s2.endpoints.google.apiKey).toBe("AIza-new");

    const s3 = updateAiFeature(s2, "continuation", false);
    expect(s3.features.continuation).toBe(false);
  });
});
