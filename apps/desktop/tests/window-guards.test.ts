import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CloseRequestedHandler = (event: { preventDefault(): void }) => void;

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  closeHandler: undefined as CloseRequestedHandler | undefined,
  dispose: vi.fn(),
  destroy: vi.fn(async () => undefined),
  onCloseRequested: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: tauri.destroy,
    onCloseRequested: tauri.onCloseRequested,
  }),
}));

import { runtime } from "../src/app/runtime/editor-runtime";
import {
  bindBrowserDirtyDocumentGuard,
  bindTauriCloseGuard,
} from "../src/app/events/window-guards";

describe("document discard window guards", () => {
  let browserHandler: ((event: BeforeUnloadEvent) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
    tauri.closeHandler = undefined;
    tauri.onCloseRequested.mockImplementation(async (handler: CloseRequestedHandler) => {
      tauri.closeHandler = handler;
      return tauri.dispose;
    });
    browserHandler = undefined;
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, handler: (event: BeforeUnloadEvent) => void) => {
        if (type === "beforeunload") browserHandler = handler;
      }),
      removeEventListener: vi.fn(),
    });
    runtime.document.replaceDocument(
      { markdown: "same\n", savedMarkdown: "same\n", filePath: "/doc.md" },
      { kind: "command", commandId: "test.window-guard.reset" },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks browser unload when persistence verification is required for clean text", () => {
    requirePersistenceVerification();
    const cleanup = bindBrowserDirtyDocumentGuard();
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;

    browserHandler?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
    cleanup();
  });

  it("blocks Tauri close and destroys only after explicit confirmation", async () => {
    requirePersistenceVerification();
    const confirmClose = vi.fn(async () => true);
    const cleanup = bindTauriCloseGuard(confirmClose);
    const event = { preventDefault: vi.fn() };

    tauri.closeHandler?.(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(confirmClose).toHaveBeenCalledOnce();
    expect(tauri.destroy).toHaveBeenCalledOnce();
    cleanup?.();
  });

  it("allows a clean verified document to close without prompting", () => {
    const confirmClose = vi.fn(async () => true);
    bindTauriCloseGuard(confirmClose);
    const event = { preventDefault: vi.fn() };

    tauri.closeHandler?.(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(confirmClose).not.toHaveBeenCalled();
  });
});

function requirePersistenceVerification() {
  const checkpoint = runtime.document.beginSave({ kind: "current-path", path: "/doc.md" });
  const result = runtime.document.settleSave(checkpoint, {
    status: "indeterminate",
    commit: "unknown",
    candidatePath: "/doc.md",
    errorCode: "transport-lost",
    verificationRequired: true,
  });
  expect(result.status).toBe("verification-required");
  expect(runtime.document.getSnapshot()).toMatchObject({
    isDirty: false,
    persistenceStatus: { kind: "verification-required" },
  });
}
