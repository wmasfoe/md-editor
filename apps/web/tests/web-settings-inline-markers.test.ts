/**
 * T-33（web 侧）：行内格式标记源码开关的设置持久化与归一化（round-trip 行为断言）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEB_SETTINGS, loadWebSettings, saveWebSettings } from "../src/lib/web-settings.ts";

const STORAGE_KEY = "md-editor:web:settings";

function stubStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) {
    store.set(STORAGE_KEY, initial);
  }
  const localStorageStub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("localStorage", localStorageStub);
  return store;
}

describe("web settings · showInlineStyleMarkers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认关闭（存量用户升级后自动生效）", () => {
    stubStorage();
    expect(DEFAULT_WEB_SETTINGS.showInlineStyleMarkers).toBe(false);
    expect(loadWebSettings().showInlineStyleMarkers).toBe(false);
  });

  it('只接受布尔 true；字符串 "true" 归一化为 false', () => {
    stubStorage(JSON.stringify({ showInlineStyleMarkers: "true" }));
    expect(loadWebSettings().showInlineStyleMarkers).toBe(false);

    stubStorage(JSON.stringify({ showInlineStyleMarkers: true }));
    expect(loadWebSettings().showInlineStyleMarkers).toBe(true);
  });

  it("保存后重新读取保持同一值（round-trip）", () => {
    stubStorage();
    saveWebSettings({ ...loadWebSettings(), showInlineStyleMarkers: true });
    expect(loadWebSettings().showInlineStyleMarkers).toBe(true);

    saveWebSettings({ ...loadWebSettings(), showInlineStyleMarkers: false });
    expect(loadWebSettings().showInlineStyleMarkers).toBe(false);
  });
});
