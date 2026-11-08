import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@md-editor/ai";
import { mergeStyleProfile } from "@md-editor/ai/style";

const saveAppSettings = vi.hoisted(() => vi.fn(async (settings: unknown) => settings));
vi.mock("../../../src/app/settings/app-settings", () => ({ saveAppSettings }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }));

import {
  ensureStyleCloudConsent,
  getStyleProfileForRequest,
  needsStyleCloudConsent,
} from "../../../src/app/ai/style-learning/style-profile-request";
import { useConfirmationStore } from "../../../src/app/stores/confirmation-store";
import { useStyleLearningStore } from "../../../src/app/ai/style-learning/style-learning-store";
import { useFileTreeStore } from "../../../src/app/stores/file-tree-store";
import type { AppSettings } from "../../../src/app/settings/app-settings";

const profile = mergeStyleProfile({
  workspace: [{ dimension: "termScript", value: "keep-english", status: "active", rounds: [] }],
});

function appSettings(ai: Partial<AiSettings>): AppSettings {
  return {
    ai: {
      ...DEFAULT_AI_SETTINGS,
      provider: "openai",
      endpoints: {
        ...DEFAULT_AI_SETTINGS.endpoints,
        openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk" },
      },
      styleLearning: { ...DEFAULT_AI_SETTINGS.styleLearning, enabled: true },
      ...ai,
    },
  } as AppSettings;
}

beforeEach(() => {
  saveAppSettings.mockClear();
  useConfirmationStore.setState({ confirmation: null });
});

/** 模拟用户在确认框中的选择 */
function answer(choice: "confirm" | "cancel") {
  const unsubscribe = useConfirmationStore.subscribe((state) => {
    if (state.confirmation) {
      unsubscribe();
      queueMicrotask(() => useConfirmationStore.getState().resolveConfirmation(choice));
    }
  });
}

describe("style cloud consent", () => {
  it("I-5: a manual cloud request asks once, listing only the rule text", async () => {
    answer("confirm");
    const next = await ensureStyleCloudConsent(appSettings({}), profile);
    const shown = saveAppSettings.mock.calls[0]?.[0] as AppSettings;
    expect(shown.ai.styleLearning.cloudConsent).toMatchObject({
      provider: "openai",
      origin: "https://api.openai.com",
    });
    expect(next.ai.styleLearning.cloudConsent).not.toBeNull();
    expect(needsStyleCloudConsent(next.ai, profile)).toBe(false);
  });

  it("I-5: declining keeps the request without preferences and stores nothing", async () => {
    let description = "";
    const unsubscribe = useConfirmationStore.subscribe((state) => {
      if (state.confirmation) {
        description = state.confirmation.description;
        unsubscribe();
        queueMicrotask(() => useConfirmationStore.getState().resolveConfirmation("cancel"));
      }
    });
    const settings = appSettings({});
    const next = await ensureStyleCloudConsent(settings, profile);
    expect(next).toBe(settings);
    expect(saveAppSettings).not.toHaveBeenCalled();
    expect(description).toContain("技术术语保留英文原文");
    expect(description).not.toMatch(/termScript|\.md|sha/u);
  });

  it("I-5: never asks for local providers, disabled learning, empty profiles or an existing grant", async () => {
    const local = appSettings({ provider: "local" });
    const disabled = appSettings({
      styleLearning: { ...DEFAULT_AI_SETTINGS.styleLearning, enabled: false },
    });
    const granted = appSettings({
      styleLearning: {
        enabled: true,
        autoRelink: false,
        cloudConsent: { provider: "openai", origin: "https://api.openai.com", grantedAt: "t" },
      },
    });
    for (const settings of [local, disabled, granted]) {
      await expect(ensureStyleCloudConsent(settings, profile)).resolves.toBe(settings);
    }
    await expect(ensureStyleCloudConsent(appSettings({}), undefined)).resolves.toBeDefined();
    expect(useConfirmationStore.getState().confirmation).toBeNull();
    // 切换到其他服务地址需要重新授权。
    const moved = appSettings({
      ...granted.ai,
      endpoints: {
        ...granted.ai.endpoints,
        openai: { ...granted.ai.endpoints.openai, baseUrl: "https://api.deepseek.com" },
      },
    });
    expect(needsStyleCloudConsent(moved.ai, profile)).toBe(true);
  });

  it("provides the merged workspace profile only while style learning is enabled", () => {
    useFileTreeStore.setState({ folder: { rootPath: "/notes", tree: null } as never });
    useStyleLearningStore.getState().setProfile({
      version: 1,
      workspaces: [
        {
          id: "ws-1",
          rootPath: "/notes",
          linkState: "linked",
          samples: [],
          rules: [{ dimension: "termScript", value: "keep-english", status: "active", rounds: [] }],
          editFeedback: [],
          roundCount: 3,
          changesSinceRound: 0,
        },
      ],
      global: { rules: [], roundCount: 0 },
      custom: [],
      aiSegments: {},
    });
    expect(getStyleProfileForRequest(appSettings({}).ai)?.rules).toHaveLength(1);
    expect(getStyleProfileForRequest(DEFAULT_AI_SETTINGS)).toBeUndefined();
  });
});
