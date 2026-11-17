// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorUiActionsContextValue } from "@md-editor/app-ui";
import type { FileSaveJob, MarkdownDocumentFile, RuntimeFileService } from "@md-editor/file-system";
import type { SaveOutcome } from "@md-editor/core";

const mocks = vi.hoisted(() => ({
  queue: [] as string[],
  listener: undefined as ((event: { payload: string }) => void) | undefined,
  invoke: vi.fn(),
  listen: vi.fn(),
  openDocumentAtPath: vi.fn(),
  enqueueSaveJob: vi.fn<(job: FileSaveJob) => Promise<SaveOutcome>>(),
  getRendererPorts: vi.fn(),
  confirmation: vi.fn(),
  setHasActiveDocument: vi.fn(),
  setOpenedAsset: vi.fn(),
  runFileAction: vi.fn(async (_label: string, action: () => Promise<void>) => action()),
  refreshFolder: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@md-editor/i18n", () => ({ t: (key: string) => key }));
vi.mock("../../../src/app/controller/recent-files-store", () => ({
  recentFilesStore: { add: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
}));
vi.mock("../../../src/app/controller/session-controller", () => ({
  checkPendingDraft: vi.fn(async () => null),
  recordDocumentHistory: vi.fn(),
  sessionStore: { clearActiveSession: vi.fn(async () => undefined) },
}));
vi.mock("../../../src/app/controller/export-controller", () => ({
  checkDocumentLinksAndLint: vi.fn(),
}));
vi.mock("../../../src/app/stores/document-ui-store", () => ({
  useDocumentUiStore: { getState: () => ({ setPendingDraft: vi.fn() }) },
}));

import { useDocumentActionsController } from "../../../src/app/controller/useDocumentActionsController";
import { listenToDesktopFileOpens } from "../../../src/desktop/file-open-events";
import { runtime } from "../../../src/app/runtime/editor-runtime";

const roots: Root[] = [];
let hasActiveDocument = false;

async function flush() {
  for (let index = 0; index < 10; index += 1) await act(async () => Promise.resolve());
}

async function mount() {
  let dispose: (() => void) | undefined;
  function Probe() {
    const actions = useDocumentActionsController({
      fileService: {
        openDocumentAtPath: mocks.openDocumentAtPath,
        enqueueSaveJob: mocks.enqueueSaveJob,
      } as unknown as RuntimeFileService,
      getRendererPorts: mocks.getRendererPorts as EditorUiActionsContextValue["getRendererPorts"],
      refreshFolderForDocumentPath: mocks.refreshFolder,
      requestConfirmation: mocks.confirmation,
      runFileAction: mocks.runFileAction,
      setHasActiveDocument: (value) => {
        hasActiveDocument = typeof value === "function" ? value(hasActiveDocument) : value;
        mocks.setHasActiveDocument(value);
      },
      setOpenedAsset: mocks.setOpenedAsset,
      showOpenedFolder: vi.fn(),
      showToast: mocks.toast,
    });
    return createElement(Listener, { open: actions.openRecentFile });
  }
  function Listener({ open }: { open: (path: string) => Promise<void> }) {
    // Models the controller's lifecycle effect: bind on mount, clean up on unmount.
    useEffect(() => {
      dispose = listenToDesktopFileOpens(open, mocks.toast);
      return () => dispose?.();
    }, [open]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.queue.length = 0;
  runtime.document.replaceDocument(
    { markdown: "", savedMarkdown: "", filePath: null },
    { kind: "command", commandId: "test.reset" },
  );
  hasActiveDocument = false;
  mocks.invoke.mockReset().mockImplementation(async () => mocks.queue.shift() ?? null);
  mocks.listen.mockReset().mockImplementation(async (_name, handler) => {
    mocks.listener = handler;
    return vi.fn();
  });
  mocks.openDocumentAtPath.mockReset();
  mocks.enqueueSaveJob.mockReset();
  mocks.getRendererPorts.mockReset().mockReturnValue({ status: "unavailable" });
  mocks.confirmation.mockReset().mockResolvedValue("secondary");
  mocks.setHasActiveDocument.mockReset();
  mocks.setOpenedAsset.mockReset();
  mocks.runFileAction.mockClear();
  mocks.refreshFolder.mockClear();
  mocks.toast.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

describe("system file open integration", () => {
  it("loads the cold-start file into the editor document", async () => {
    mocks.queue.push("/notes/startup.md");
    mocks.openDocumentAtPath.mockResolvedValue({
      filePath: "/notes/startup.md",
      markdown: "# Startup",
    } satisfies MarkdownDocumentFile);
    await mount();
    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/notes/startup.md",
      markdown: "# Startup",
    });
    expect(hasActiveDocument).toBe(true);
    expect(mocks.refreshFolder).toHaveBeenCalledWith("/notes/startup.md");
  });

  it("honors cancel when opening a system file would discard unsaved edits", async () => {
    runtime.document.replaceDocument(
      { markdown: "unsaved", savedMarkdown: "saved", filePath: "/old.md" },
      { kind: "command", commandId: "test.dirty" },
    );
    mocks.openDocumentAtPath.mockResolvedValue({ filePath: "/new.md", markdown: "new" });
    mocks.confirmation.mockResolvedValue("cancel");
    await mount();
    mocks.queue.push("/new.md");
    await act(async () => mocks.listener?.({ payload: "" }));
    await flush();
    await flush();
    expect(mocks.confirmation).toHaveBeenCalledOnce();
    expect(mocks.openDocumentAtPath).not.toHaveBeenCalled();
    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/old.md",
      markdown: "unsaved",
      isDirty: true,
    });
  });

  it("flushes buffered typing before deciding whether a system open needs confirmation", async () => {
    runtime.document.replaceDocument(
      { markdown: "saved", savedMarkdown: "saved", filePath: "/old.md" },
      { kind: "command", commandId: "test.clean" },
    );
    const flushPendingEdits = vi.fn(() => {
      runtime.document.applyEditorChange("just typed", {
        kind: "renderer",
        clientId: "system-open-test",
        sequence: 1,
      });
    });
    mocks.getRendererPorts.mockReturnValue({ status: "available", ports: { flushPendingEdits } });
    mocks.confirmation.mockResolvedValue("cancel");
    await mount();
    mocks.queue.push("/new.md");
    await act(async () => mocks.listener?.({ payload: "" }));
    await flush();

    expect(flushPendingEdits).toHaveBeenCalledOnce();
    expect(mocks.confirmation).toHaveBeenCalledOnce();
    expect(mocks.openDocumentAtPath).not.toHaveBeenCalled();
    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/old.md",
      markdown: "just typed",
      isDirty: true,
    });
  });

  it("opens the requested file after the user chooses to discard old edits", async () => {
    runtime.document.replaceDocument(
      { markdown: "unsaved", savedMarkdown: "saved", filePath: "/old.md" },
      { kind: "command", commandId: "test.dirty" },
    );
    mocks.openDocumentAtPath.mockResolvedValue({ filePath: "/new.md", markdown: "# New" });
    mocks.confirmation.mockResolvedValue("secondary");
    await mount();
    mocks.queue.push("/new.md");
    await act(async () => mocks.listener?.({ payload: "" }));
    await flush();

    expect(mocks.confirmation).toHaveBeenCalledOnce();
    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/new.md",
      markdown: "# New",
      isDirty: false,
    });
  });

  it("saves the current file before reading the requested file when confirmed", async () => {
    runtime.document.replaceDocument(
      { markdown: "new local edits", savedMarkdown: "saved", filePath: "/old.md" },
      { kind: "command", commandId: "test.dirty" },
    );
    const order: string[] = [];
    let finishSave!: (outcome: SaveOutcome) => void;
    mocks.confirmation.mockResolvedValue("confirm");
    mocks.enqueueSaveJob.mockImplementation((job) => {
      expect(job.destination).toEqual({ kind: "current-path", path: "/old.md" });
      order.push(`save:${job.markdownLf}`);
      return new Promise<SaveOutcome>((resolve) => {
        finishSave = (outcome) => {
          order.push("saved");
          resolve(outcome);
        };
      });
    });
    mocks.openDocumentAtPath.mockImplementation(async (path) => {
      order.push(`open:${path}`);
      return { filePath: path, markdown: "# Requested" };
    });
    await mount();
    mocks.queue.push("/requested.md");
    await act(async () => mocks.listener?.({ payload: "" }));
    await flush();
    expect(mocks.openDocumentAtPath).not.toHaveBeenCalled();
    expect(order).toEqual(["save:new local edits"]);

    await act(async () => finishSave(committed("/old.md")));
    await flush();
    expect(order).toEqual(["save:new local edits", "saved", "open:/requested.md"]);
    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/requested.md",
      markdown: "# Requested",
      isDirty: false,
    });
  });

  it.each([
    ["failed", { status: "failed", commit: "not-committed", phase: "rename", errorCode: "denied" }],
    [
      "indeterminate",
      {
        status: "indeterminate",
        commit: "unknown",
        candidatePath: "/old.md",
        errorCode: "transport-lost",
        verificationRequired: true,
      },
    ],
  ] satisfies Array<readonly [string, SaveOutcome]>)(
    "keeps the current file when the save before opening is %s",
    async (_name, outcome) => {
      runtime.document.replaceDocument(
        { markdown: "local edits", savedMarkdown: "saved", filePath: "/old.md" },
        { kind: "command", commandId: "test.dirty" },
      );
      mocks.confirmation.mockResolvedValue("confirm");
      mocks.enqueueSaveJob.mockResolvedValue(outcome);
      await mount();
      mocks.queue.push("/requested.md");
      await act(async () => mocks.listener?.({ payload: "" }));
      await flush();

      expect(mocks.openDocumentAtPath).not.toHaveBeenCalled();
      expect(runtime.document.getSnapshot()).toMatchObject({
        filePath: "/old.md",
        markdown: "local edits",
      });
    },
  );

  it("preserves the current document and reports an error when the requested file cannot be read", async () => {
    runtime.document.replaceDocument(
      { markdown: "keep me", savedMarkdown: "keep me", filePath: "/old.md" },
      { kind: "command", commandId: "test.clean" },
    );
    mocks.openDocumentAtPath.mockRejectedValue(new Error("read failed"));
    await mount();
    mocks.queue.push("/missing.md");
    await act(async () => mocks.listener?.({ payload: "" }));
    await flush();
    await flush();

    expect(runtime.document.getSnapshot()).toMatchObject({
      filePath: "/old.md",
      markdown: "keep me",
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "read failed" }));
  });
});

function committed(filePath: string): SaveOutcome {
  return { status: "succeeded", commit: "committed", filePath, warnings: [] };
}
