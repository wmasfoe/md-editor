/**
 * T-33（uTools 侧）：行内格式标记源码开关的默认值与归一化。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UTOOLS_SETTINGS,
  UTOOLS_SETTINGS_KEY,
  loadUtoolsSettings,
} from "../src/utools/db-storage.ts";

/**
 * uTools 运行时优先走 `window.utools.dbStorage`，浏览器降级走 `localStorage`。
 * 这里两者都注入同一份假存储，避免测试依赖宿主环境的 localStorage 实现。
 */
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
  };
  vi.stubGlobal("localStorage", fakeStorage);
  vi.stubGlobal("window", { utools: { dbStorage: fakeStorage } });
}

describe("uTools settings · showInlineStyleMarkers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认关闭", () => {
    stubStorage();
    expect(DEFAULT_UTOOLS_SETTINGS.showInlineStyleMarkers).toBe(false);
    expect(loadUtoolsSettings().showInlineStyleMarkers).toBe(false);
  });

  it("只接受布尔 true", () => {
    stubStorage(JSON.stringify({ showInlineStyleMarkers: "true" }));
    expect(loadUtoolsSettings().showInlineStyleMarkers).toBe(false);

    stubStorage(JSON.stringify({ showInlineStyleMarkers: true }));
    expect(loadUtoolsSettings().showInlineStyleMarkers).toBe(true);
  });

  it("损坏 JSON 回退默认（不抛错）", () => {
    stubStorage("{not-json");
    expect(loadUtoolsSettings().showInlineStyleMarkers).toBe(false);
  });
});
