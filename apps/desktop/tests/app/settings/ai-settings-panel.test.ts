// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@md-editor/ai";
import { changeLanguage } from "@md-editor/i18n";
import { AiSettingsPanel } from "../../../src/components/settings/AiSettingsPanel";

vi.mock("../../../src/app/ai/desktop-ai-service", () => ({
  desktopAiService: { testConnection: vi.fn() },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("zh");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe("AI settings background processing", () => {
  it("discloses automatic remote processing and changes only its own setting", async () => {
    const changes = vi.fn();
    const initialSettings: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: false,
      features: { ...DEFAULT_AI_SETTINGS.features, continuation: true },
    };

    function Panel() {
      const [settings, setSettings] = useState(initialSettings);
      return createElement(AiSettingsPanel, {
        aiSettingsDraft: settings,
        isLocalModelActionPending: false,
        onChangeAiSettings: (next: AiSettings) => {
          changes(next);
          setSettings(next);
        },
        onDownloadLocalModel: vi.fn(),
        onCancelLocalModelDownload: vi.fn(),
        onDeleteLocalModel: vi.fn(),
      });
    }

    await act(async () => root?.render(createElement(Panel)));
    const checkbox = container?.querySelector<HTMLInputElement>(
      'input[aria-describedby="ai-background-processing-description"]',
    );
    const description = container?.querySelector("#ai-background-processing-description");
    expect(checkbox?.checked).toBe(false);
    expect(description?.textContent).toContain("自动生成建议");
    expect(description?.textContent).toContain("当前文档的部分或全部内容可能被发送");
    expect(description?.textContent).toContain("不影响手动纠错和续写");

    await act(async () => checkbox?.click());
    expect(changes).toHaveBeenLastCalledWith({
      ...initialSettings,
      features: { ...initialSettings.features, backgroundProcessing: true },
    });
    expect(checkbox?.checked).toBe(true);

    await act(async () => checkbox?.click());
    expect(changes).toHaveBeenLastCalledWith(initialSettings);
    expect(checkbox?.checked).toBe(false);
  });
});
