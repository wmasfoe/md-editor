import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenToDesktopMenuActions, MENU_ACTION_EVENT } from "../src/desktop/menu-events";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: tauri.isTauri
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen
}));

describe("desktop menu events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
  });

  it("unsubscribes after the native listener has registered", async () => {
    const dispose = vi.fn();
    tauri.listen.mockResolvedValue(dispose);

    const cleanup = listenToDesktopMenuActions(vi.fn());
    await Promise.resolve();
    cleanup?.();

    expect(tauri.listen).toHaveBeenCalledWith(MENU_ACTION_EVENT, expect.any(Function));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("unsubscribes listeners that finish registering after React cleanup", async () => {
    const dispose = vi.fn();
    let resolveListen: ((dispose: () => void) => void) | null = null;
    tauri.listen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      })
    );

    const cleanup = listenToDesktopMenuActions(vi.fn());
    cleanup?.();
    expect(dispose).not.toHaveBeenCalled();

    resolveListen?.(dispose);
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
