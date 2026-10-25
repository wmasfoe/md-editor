import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UTOOLS_SETTINGS,
  loadUtoolsSettings,
  UTOOLS_SETTINGS_KEY,
} from "../src/utools/db-storage";
import {
  acceptAiDisclaimer,
  hasAcceptedAiDisclaimer,
  resetAiDisclaimer,
} from "../src/utools/ai-disclaimer";
import { utoolsAiService } from "../src/utools/ai-service";

function stubStorage(raw?: string) {
  const store = new Map<string, string>();
  if (raw !== undefined) {
    store.set(UTOOLS_SETTINGS_KEY, raw);
  }
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  vi.stubGlobal("localStorage", fakeStorage);
  vi.stubGlobal("window", { utools: { dbStorage: fakeStorage } });
  return store;
}

describe("uTools AI Settings & Service", () => {
  beforeEach(() => {
    stubStorage();
    resetAiDisclaimer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes default settings with normalized AI config", () => {
    const settings = DEFAULT_UTOOLS_SETTINGS;
    expect(settings.ai).toBeDefined();
    expect(settings.ai.enabled).toBe(true);
    expect(settings.ai.provider).toBe("openai");
    expect(settings.ai.endpoints.openai.baseUrl).toBe("https://api.deepseek.com");
    expect(settings.ai.endpoints.openai.model).toBe("deepseek-chat");
    expect(settings.ai.features.editing).toBe(true);
    expect(settings.ai.features.continuation).toBe(false);
  });

  it("normalizes saved partial settings and migrates legacy formats", () => {
    stubStorage(
      JSON.stringify({
        theme: "dark",
        fontSize: 16,
        ai: {
          enabled: true,
          provider: "openai-compatible",
          baseUrl: "https://custom.gateway.internal/v1",
          apiKey: "sk-custom-secret",
          model: "gpt-4o",
        },
      }),
    );

    const loaded = loadUtoolsSettings();
    expect(loaded.theme).toBe("dark");
    expect(loaded.fontSize).toBe(16);
    expect(loaded.ai.provider).toBe("openai");
    expect(loaded.ai.endpoints.openai.baseUrl).toBe("https://custom.gateway.internal/v1");
    expect(loaded.ai.endpoints.openai.apiKey).toBe("sk-custom-secret");
    expect(loaded.ai.endpoints.openai.model).toBe("gpt-4o");
  });

  it("manages AI safety disclaimer lifecycle", () => {
    expect(hasAcceptedAiDisclaimer()).toBe(false);
    acceptAiDisclaimer();
    expect(hasAcceptedAiDisclaimer()).toBe(true);
    resetAiDisclaimer();
    expect(hasAcceptedAiDisclaimer()).toBe(false);
  });

  it("validates readiness for continuation and editing via utoolsAiService", () => {
    const settings = {
      ...DEFAULT_UTOOLS_SETTINGS,
      ai: {
        ...DEFAULT_UTOOLS_SETTINGS.ai,
        features: {
          editing: true,
          continuation: true,
        },
        endpoints: {
          ...DEFAULT_UTOOLS_SETTINGS.ai.endpoints,
          openai: {
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
            apiKey: "",
          },
        },
      },
    };

    // 云端非回环服务在未配置 key 时应提示配置 API Key
    const readiness = utoolsAiService.checkReadiness(settings.ai, "continuation");
    expect(readiness).toContain("API Key");
  });

  it("rejects local model usage on uTools platform", () => {
    const settings = {
      ...DEFAULT_UTOOLS_SETTINGS,
      ai: {
        ...DEFAULT_UTOOLS_SETTINGS.ai,
        features: {
          editing: true,
          continuation: true,
        },
        provider: "local" as const,
      },
    };

    const readiness = utoolsAiService.checkReadiness(settings.ai, "continuation");
    expect(readiness).toContain("不支持离线本地模型");
  });
});
