// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeFileService } from "@md-editor/file-system";

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(async (_path: string) => undefined),
  showToast: vi.fn(),
  listen: vi.fn(),
  dispose: vi.fn(),
  getRendererPorts: vi.fn(() => ({ status: "unavailable" })),
  pendingDraft: vi.fn(),
  snapshot: {
    filePath: null,
    markdown: "",
    isDirty: false,
    mode: "wysiwyg",
    documentGeneration: 1,
  },
}));

// The real controller owns this subscription. Do not recreate its lifecycle in
// the harness: removing the production binding must make these tests fail.
vi.mock("../../../src/desktop/file-open-events", () => ({
  listenToDesktopFileOpens: mocks.listen,
}));
vi.mock("../../../src/app/controller/useDocumentActionsController", () => ({
  useDocumentActionsController: () => ({ openRecentFile: mocks.openFile }),
}));
vi.mock("../../../src/app/document-store", () => ({ useDocumentSnapshot: () => mocks.snapshot }));
vi.mock("../../../src/app/runtime/editor-runtime", () => ({
  runtime: { document: { getSnapshot: () => mocks.snapshot } },
}));
vi.mock("../../../src/app/settings-context", () => ({
  useAppSettings: () => ({ settings: {}, updateStatus: { state: "idle" } }),
}));
vi.mock("@md-editor/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@md-editor/app-ui", () => ({
  useEditorUiActions: () => ({ getRendererPorts: mocks.getRendererPorts }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../../../src/app/ai/desktop-ai-service", () => ({ desktopAiService: {} }));
vi.mock("../../../src/app/ai/style-learning/style-profile-request", () => ({
  ensureStyleCloudConsent: vi.fn(),
  getStyleProfileForRequest: vi.fn(),
}));
vi.mock("../../../src/app/controller/export-controller", () => ({
  copyDocumentAsHtml: vi.fn(),
  checkDocumentLinksAndLint: vi.fn(),
  exportDocumentAsHtml: vi.fn(),
  exportDocumentAsPdf: vi.fn(),
  resolveExportStyling: vi.fn(),
}));
vi.mock("../../../src/app/controller/session-controller", () => ({
  checkPendingDraft: async () => null,
}));
vi.mock("../../../src/app/controller/recent-files-store", () => ({ recentFilesStore: {} }));
vi.mock("../../../src/app/events/command-bindings", () => ({
  bindDesktopMenuCommands: vi.fn(),
  bindRuntimeKeyboardShortcuts: vi.fn(),
}));
vi.mock("../../../src/app/events/recent-file-events", () => ({
  bindRecentFileMenuEvents: vi.fn(),
}));
vi.mock("../../../src/app/events/window-guards", () => ({
  bindBrowserDirtyDocumentGuard: vi.fn(),
  bindTauriCloseGuard: vi.fn(),
}));
vi.mock("../../../src/desktop/folder-watcher-events", () => ({ listenToFolderChanged: vi.fn() }));
vi.mock("../../../src/app/updates/update-bridge", () => ({ listenUpdateCommands: vi.fn() }));
vi.mock("../../../src/app/stores/confirmation-store", () => ({
  useConfirmationStore: (select: (state: unknown) => unknown) => select({}),
}));
vi.mock("../../../src/app/stores/document-ui-store", () => ({
  useDocumentUiStore: Object.assign((select: (state: unknown) => unknown) => select({}), {
    getState: () => ({ setPendingDraft: mocks.pendingDraft }),
  }),
}));
vi.mock("../../../src/app/stores/file-action-store", () => ({
  useFileActionStore: (select: (state: unknown) => unknown) => select({}),
}));
vi.mock("../../../src/app/stores/file-tree-store", () => ({
  useFileTreeStore: (select: (state: unknown) => unknown) => select({}),
}));

import { useDesktopEditorController } from "../../../src/app/controller/useDesktopEditorController";

let root: Root;
const fileService = {} as RuntimeFileService;
function Probe({ showToast = mocks.showToast }) {
  useDesktopEditorController({ fileService, showToast });
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.openFile = vi.fn(async (_path: string) => undefined);
  mocks.listen.mockReturnValue(mocks.dispose);
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("desktop controller system file open binding", () => {
  it("routes an OS request through the mounted controller's document action", async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(mocks.listen).toHaveBeenCalledOnce();
    const [open] = mocks.listen.mock.calls[0]!;
    await act(async () => open("/notes/中文 #1.md"));
    expect(mocks.openFile.mock.calls).toEqual([["/notes/中文 #1.md"]]);
  });

  it("keeps one subscription while routing to the latest action and error feedback after rerender", async () => {
    await act(async () => root.render(createElement(Probe)));
    const [open, onError] = mocks.listen.mock.calls[0]!;
    const previousOpen = mocks.openFile;
    mocks.openFile = vi.fn(async (_path: string) => undefined);
    const latestToast = vi.fn();
    await act(async () => root.render(createElement(Probe, { showToast: latestToast })));
    await act(async () => open("/next.md"));
    onError(new Error("permission denied"));

    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(previousOpen).not.toHaveBeenCalled();
    expect(mocks.openFile.mock.calls).toEqual([["/next.md"]]);
    expect(latestToast).toHaveBeenCalledWith("permission denied");
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("removes the subscription when the main editor unmounts", async () => {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.render(null));
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
