// @vitest-environment jsdom
/**
 * use-app-updates 的行为测试：用内存事件总线模拟 Tauri 跨窗口事件，用假的 updater 替代插件。
 * 覆盖：设置窗口只转发不执行、sync 后拿到快照、下载失败回到可重试、「稍后」不下载、
 * 手动检查失败的轻提示。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../../src/app/settings/app-settings";
import type * as PromptStateModule from "../../../src/app/updates/prompt-state";

const bus = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
  return {
    listeners,
    emitted: [] as Array<{ event: string; payload: unknown }>,
    reset() {
      listeners.clear();
      this.emitted.length = 0;
    },
  };
});

const updater = vi.hoisted(() => ({
  checkForInstallableUpdate: vi.fn(),
  downloadPendingUpdate: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  relaunchAfterUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  // 与真实 Tauri 一致：emit 广播给所有窗口（包括自己），listen 注册是异步的。
  emit: async (event: string, payload: unknown) => {
    bus.emitted.push({ event, payload });
    for (const listener of bus.listeners.get(event) ?? []) listener({ payload });
  },
  listen: async (event: string, listener: (event: { payload: unknown }) => void) => {
    const set = bus.listeners.get(event) ?? new Set();
    set.add(listener);
    bus.listeners.set(event, set);
    return () => set.delete(listener);
  },
}));
vi.mock("../../../src/app/updates/app-updater", () => updater);
vi.mock("../../../src/app/updates/prompt-state", async (importOriginal) => {
  const actual = await importOriginal<typeof PromptStateModule>();
  return {
    ...actual,
    loadUpdatePromptState: async () => ({}),
    saveUpdatePromptState: vi.fn(async () => undefined),
    listenUpdatePromptStateChanged: () => undefined,
  };
});
vi.mock("@md-editor/i18n", () => ({ t: (key: string) => key }));

import { useAppUpdates, type AppUpdatesValue } from "../../../src/app/updates/use-app-updates";

const NOTES = "## 0.22.0 - 2026-11-10 (#225)\n\n- 修复更新流程";
const available: UpdateStatus = {
  currentVersion: "0.21.0",
  state: "available",
  latestVersion: "0.22.0",
  releaseNotes: NOTES,
};

interface Harness {
  readonly current: () => AppUpdatesValue;
  readonly toasts: Array<string | null>;
  readonly unmount: () => void;
}

const roots: Root[] = [];

async function flush() {
  // 让 listen 注册、检查 Promise 与 React 更新全部落定。
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderUpdates(
  surface: "main" | "settings-window",
  automaticCheck = true,
): Promise<Harness> {
  const toasts: Array<string | null> = [];
  let latest: AppUpdatesValue | undefined;
  function Probe() {
    latest = useAppUpdates({
      surface,
      updateSettings: { automaticCheck, automaticDownload: true },
      hasLoadedSettings: true,
      showToast: (message) => toasts.push(message),
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(Probe)));
  await flush();
  return {
    current: () => {
      if (!latest) throw new Error("hook not rendered");
      return latest;
    },
    toasts,
    unmount: () => act(() => root.unmount()),
  };
}

function commandsSent(): unknown[] {
  return bus.emitted
    .filter((entry) => entry.event === "md-editor-update-command")
    .map((entry) => entry.payload);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 首帧闸门依赖 rAF；测试里同步执行，等价于「首帧已绘制」。
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  bus.reset();
  for (const fn of Object.values(updater)) fn.mockReset();
  updater.checkForInstallableUpdate.mockResolvedValue({ status: available });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useAppUpdates — main window", () => {
  it("checks on startup and holds the download until the notice is answered", async () => {
    const main = await renderUpdates("main");
    expect(updater.checkForInstallableUpdate).toHaveBeenCalledTimes(1);
    expect(main.current().updateStatus.state).toBe("available");
    expect(main.current().updateNotice?.version).toBe("0.22.0");
    expect(updater.downloadPendingUpdate).not.toHaveBeenCalled();
  });

  it("「稍后」 closes the notice and never downloads, even with auto-download on", async () => {
    const main = await renderUpdates("main");
    await act(async () => main.current().resolveUpdateNotice("later", "0.22.0"));
    await flush();
    expect(main.current().updateNotice).toBeNull();
    expect(updater.downloadPendingUpdate).not.toHaveBeenCalled();
  });

  it("falls back to available with a toast when a manual download fails", async () => {
    updater.downloadPendingUpdate.mockResolvedValue({
      ...available,
      state: "error",
      error: "network down",
    });
    const main = await renderUpdates("main");
    let result: UpdateStatus | undefined;
    await act(async () => {
      result = await main.current().downloadUpdate();
    });
    expect(result?.state).toBe("available");
    expect(main.current().updateStatus.state).toBe("available");
    expect(main.toasts).toContain("settings.updates.toasts.downloadFailed");
  });

  it("toasts on a failed manual check but stays silent for the automatic one", async () => {
    updater.checkForInstallableUpdate.mockResolvedValue({
      status: { currentVersion: "0.21.0", state: "up-to-date" },
      checkFailed: "offline",
    });
    const main = await renderUpdates("main");
    expect(main.toasts).toEqual([]);
    expect(main.current().lastCheckedAt).toBeNull();

    await act(async () => {
      await main.current().checkForUpdate();
    });
    expect(main.current().updateStatus.state).toBe("up-to-date");
    expect(main.toasts).toEqual(["settings.updates.toasts.checkFailed"]);
    // 失败的检查不能刷新「上次检查」时间。
    expect(main.current().lastCheckedAt).toBeNull();
  });
});

describe("useAppUpdates — settings window", () => {
  it("never calls the updater; it forwards check and download to the main window", async () => {
    const settings = await renderUpdates("settings-window");
    await act(async () => {
      await settings.current().checkForUpdate();
      await settings.current().downloadUpdate();
    });
    expect(updater.checkForInstallableUpdate).not.toHaveBeenCalled();
    expect(updater.downloadPendingUpdate).not.toHaveBeenCalled();
    expect(commandsSent()).toEqual(["sync", "check", "download"]);
    expect(settings.current().updateNotice).toBeNull();
  });

  it("mirrors the main window's snapshot after sync, without duplicating work", async () => {
    const main = await renderUpdates("main");
    expect(main.current().updateStatus.state).toBe("available");

    const settings = await renderUpdates("settings-window");
    // 设置窗口打开时发 sync，主窗口回发快照。
    expect(settings.current().updateStatus).toMatchObject({
      state: "available",
      latestVersion: "0.22.0",
    });
    expect(settings.current().lastCheckedAt).toBe(main.current().lastCheckedAt);

    // 设置窗口的手动检查由主窗口执行，只检查一次。
    updater.checkForInstallableUpdate.mockClear();
    await act(async () => {
      await settings.current().checkForUpdate();
    });
    await flush();
    expect(updater.checkForInstallableUpdate).toHaveBeenCalledTimes(1);
  });
});
