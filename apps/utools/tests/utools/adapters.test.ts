// apps/utools/src/utools/__tests__/adapters.test.ts
// uTools 适配层单元测试

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import {
  createUtoolsFileAdapter,
  createUtoolsNativeSaveAdapter,
} from "../../src/utools/file-adapter";
import {
  loadUtoolsSettings,
  saveUtoolsSettings,
  DEFAULT_UTOOLS_SETTINGS,
} from "../../src/utools/db-storage";
import {
  resolveProseFontStack,
  resolveCodeFontStack,
  PROSE_FONT_OPTIONS,
  CODE_FONT_OPTIONS,
} from "@md-editor/app-ui";
import {
  hasAcceptedAiDisclaimer,
  acceptAiDisclaimer,
  resetAiDisclaimer,
} from "../../src/utools/ai-disclaimer";
import { buildReferralUrl } from "../../src/utools/referral";
import type { NativeFileSaveJob } from "@md-editor/file-system";

describe("uTools Platform Adapters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Ensure window exists in node test environment
    (globalThis as unknown as { window: unknown }).window = globalThis;

    // Mock scoped grants from the preload bridge
    const mockFolder = {
      rootPath: "/mock/workspace",
      rootName: "workspace",
      tree: {
        name: "workspace",
        id: "workspace-id",
        path: "/mock/workspace",
        kind: "directory" as const,
        children: [
          {
            name: "README.md",
            path: "/mock/workspace/README.md",
            kind: "markdown" as const,
            id: "readme-id",
          },
        ],
      },
    };

    const testFile = { filePath: "/mock/test.md", markdown: "# Test", id: "doc-id" };
    window.inkpointNodeBridge = {
      subscribeLifecycle: vi.fn(() => () => {}),
      pickDocument: vi.fn(() => testFile),
      pickWorkspace: vi.fn(() => mockFolder),
      refreshWorkspace: vi.fn(() => mockFolder),
      openWorkspaceDocument: vi.fn(() => ({
        filePath: "/mock/workspace/README.md",
        markdown: "# Readme",
        id: "doc-id",
      })),
      writeCurrentDocument: vi.fn(() => testFile.filePath),
      saveNewDocument: vi.fn(() => null),
      closeDocument: vi.fn(),
      closeWorkspace: vi.fn(),
      saveDocumentImage: vi.fn(),
      resolveDocumentImage: vi.fn(),
      createWorkspaceItem: vi.fn(() => "/mock/workspace/test.md"),
      renameWorkspaceItem: vi.fn(() => "/mock/workspace/renamed.md"),
      deleteWorkspaceItem: vi.fn(),
    };

    // Mock window.utools
    const mockStorage = new Map<string, string>();
    const mockDb = new Map<string, unknown>();

    (window as unknown as { utools: unknown }).utools = {
      showOpenDialog: vi.fn(() => ["/mock/test.md"]),
      showSaveDialog: vi.fn(() => "/mock/saved.md"),
      shellOpenExternal: vi.fn(),
      hideMainWindowPasteText: vi.fn(),
      db: {
        get: vi.fn((id: string) => mockDb.get(id) ?? null),
        put: vi.fn((doc: { _id: string }) => {
          mockDb.set(doc._id, doc);
          return { ok: true };
        }),
      },
      dbStorage: {
        getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStorage.set(key, val);
        }),
        removeItem: vi.fn((key: string) => {
          mockStorage.delete(key);
        }),
      },
    };
  });

  describe("File Adapter", () => {
    it("reads markdown file through node bridge", async () => {
      const adapter = createUtoolsFileAdapter();
      await adapter.openMarkdownFolder();
      const file = await adapter.readMarkdownFile("/mock/workspace/README.md");

      expect(file.filePath).toBe("/mock/workspace/README.md");
      expect(file.markdown).toBe("# Readme");
      expect(window.inkpointNodeBridge?.openWorkspaceDocument).toHaveBeenCalledWith("readme-id");
    });

    it("opens markdown file via utools dialog", async () => {
      const adapter = createUtoolsFileAdapter();
      const file = await adapter.openMarkdownFile();

      expect(file).not.toBeNull();
      expect(file?.filePath).toBe("/mock/test.md");
      expect(window.inkpointNodeBridge?.pickDocument).toHaveBeenCalled();
    });

    it("opens markdown folder via utools dialog and scans folder tree", async () => {
      const adapter = createUtoolsFileAdapter();
      const folder = await adapter.openMarkdownFolder();

      expect(folder).not.toBeNull();
      expect(folder?.rootPath).toBe("/mock/workspace");
      expect(window.inkpointNodeBridge?.pickWorkspace).toHaveBeenCalled();
    });

    it("creates, renames and deletes tree items", async () => {
      const adapter = createUtoolsFileAdapter();
      await adapter.openMarkdownFolder();
      const createRes = await adapter.createMarkdownTreeItem({
        rootPath: "/mock/workspace",
        parentPath: "/mock/workspace",
        name: "test.md",
        kind: "markdown",
      });
      expect(createRes.affectedPath).toBe("/mock/workspace/test.md");
      expect(window.inkpointNodeBridge?.createWorkspaceItem).toHaveBeenCalledWith(
        "workspace-id",
        "test.md",
        "markdown",
      );

      const renameRes = await adapter.renameMarkdownTreeItem({
        rootPath: "/mock/workspace",
        path: "/mock/workspace/README.md",
        name: "renamed.md",
      });
      expect(renameRes.affectedPath).toBe("/mock/workspace/renamed.md");
      expect(window.inkpointNodeBridge?.renameWorkspaceItem).toHaveBeenCalledWith(
        "readme-id",
        "renamed.md",
      );

      const deleteRes = await adapter.deleteMarkdownTreeItem({
        rootPath: "/mock/workspace",
        path: "/mock/workspace/README.md",
      });
      expect(deleteRes.affectedPath).toBeNull();
      expect(window.inkpointNodeBridge?.deleteWorkspaceItem).toHaveBeenCalledWith("readme-id");
    });

    it("handles save job to existing path", async () => {
      await createUtoolsFileAdapter().openMarkdownFile();
      const saveAdapter = createUtoolsNativeSaveAdapter();
      const job: NativeFileSaveJob = {
        jobId: "job-1",
        checkpointSequence: 1,
        documentGeneration: 1,
        markdownLf: "# Hello Save",
        destination: { kind: "current-path", path: "/mock/test.md" },
        orderingToken: { epoch: 1, id: 1, runtimeSequence: 1 },
      };

      const outcome = await saveAdapter.saveMarkdownJob(job);
      expect(outcome).toEqual({
        status: "committed",
        runtimeSequence: 1,
        filePath: "/mock/test.md",
        warnings: [],
      });
      expect(window.inkpointNodeBridge?.writeCurrentDocument).toHaveBeenCalledWith(
        "doc-id",
        "# Hello Save",
      );
    });

    it("handles user cancelling save dialog", async () => {
      const saveAdapter = createUtoolsNativeSaveAdapter();
      const job: NativeFileSaveJob = {
        jobId: "job-2",
        checkpointSequence: 2,
        documentGeneration: 1,
        markdownLf: "# Cancel Test",
        destination: { kind: "prompt" },
        orderingToken: { epoch: 1, id: 1, runtimeSequence: 2 },
      };

      const outcome = await saveAdapter.saveMarkdownJob(job);
      expect(outcome).toEqual({
        status: "not-committed",
        disposition: "cancelled",
        runtimeSequence: 2,
        phase: "dialog",
      });
    });
  });

  describe("AI Disclaimer", () => {
    it("tracks disclaimer acceptance state", () => {
      resetAiDisclaimer();
      expect(hasAcceptedAiDisclaimer()).toBe(false);

      acceptAiDisclaimer();
      expect(hasAcceptedAiDisclaimer()).toBe(true);
    });
  });

  describe("Settings & Customization", () => {
    it("loads default settings when nothing is stored", () => {
      const settings = loadUtoolsSettings();
      expect(settings).toEqual(DEFAULT_UTOOLS_SETTINGS);
      expect(settings.theme).toBe("system");
      expect(settings.fontSize).toBe(15);
    });

    it("saves and persists settings in utools.dbStorage", () => {
      const updated = {
        theme: "dark" as const,
        fontSize: 18,
        proseFontFamily: "lxgw-wenkai",
        codeFontFamily: "jetbrains-mono",
        showCodeBlockLineNumbers: true,
        showInlineStyleMarkers: true,
        enableMarkdownLint: false,
        ai: DEFAULT_UTOOLS_SETTINGS.ai,
      };
      saveUtoolsSettings(updated);

      const loaded = loadUtoolsSettings();
      expect(loaded.theme).toBe("dark");
      expect(loaded.fontSize).toBe(18);
      expect(loaded.proseFontFamily).toBe("lxgw-wenkai");
      expect(loaded.codeFontFamily).toBe("jetbrains-mono");
      expect(loaded.showCodeBlockLineNumbers).toBe(true);
      expect(loaded.enableMarkdownLint).toBe(false);
    });
  });

  describe("Font Stacks Resolution", () => {
    it("resolves prose fonts correctly", () => {
      expect(resolveProseFontStack("")).toBe("");
      expect(resolveProseFontStack("lxgw-wenkai")).toContain("LXGW WenKai");
      expect(resolveProseFontStack("system-sans")).toContain("PingFang SC");
      // Custom font string fallback appends system sans
      expect(resolveProseFontStack("CustomFont, serif")).toContain("CustomFont, serif");
      expect(resolveProseFontStack("CustomFont, serif")).toContain("PingFang SC");
    });

    it("resolves code fonts correctly", () => {
      expect(resolveCodeFontStack("")).toBe("");
      expect(resolveCodeFontStack("jetbrains-mono")).toContain("JetBrains Mono");
      expect(resolveCodeFontStack("system-mono")).toContain("ui-monospace");
      // Custom font string fallback appends system mono
      expect(resolveCodeFontStack("Operator Mono, monospace")).toContain(
        "Operator Mono, monospace",
      );
      expect(resolveCodeFontStack("Operator Mono, monospace")).toContain("ui-monospace");
    });

    it("provides predefined font options", () => {
      expect(PROSE_FONT_OPTIONS.length).toBeGreaterThan(3);
      expect(CODE_FONT_OPTIONS.length).toBeGreaterThan(3);
    });
  });

  describe("Scoped Preload Bridge", () => {
    it("resolves only supported images within the authorized directories", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");
      const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-img-")));
      const docs = path.join(tmp, "docs");
      const note = path.join(docs, "note.md");
      const image = path.join(tmp, "outside.png");
      try {
        fs.mkdirSync(path.join(docs, "assets"), { recursive: true });
        fs.writeFileSync(note, "# Note");
        fs.writeFileSync(image, "outside");
        fs.writeFileSync(path.join(docs, "assets", "test image.png"), "inside");
        fs.writeFileSync(path.join(docs, "local.txt"), "not an image");
        vi.mocked(window.utools.showOpenDialog).mockReturnValue([note]);
        delete require.cache[require.resolve("../../preload/index.js")];
        require("../../preload/index.js");
        const bridge = window.inkpointNodeBridge!;
        const { id } = bridge.pickDocument()!;
        expect(bridge.resolveDocumentImage(id, "https://example.com/pic.png")).toBe(
          "https://example.com/pic.png",
        );
        expect(bridge.resolveDocumentImage(id, "<assets/test%20image.png?v=123#center>")).toBe(
          "data:image/png;base64," + Buffer.from("inside").toString("base64"),
        );
        for (const blocked of [image, "../outside.png", "local.txt", "assets/missing.png"]) {
          expect(bridge.resolveDocumentImage(id, blocked)).toMatch(/^data:image\/gif;/);
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("uses workspace node IDs for tree operations and protects the workspace root", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");
      const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-tree-")));
      try {
        vi.mocked(window.utools.showOpenDialog).mockReturnValue([tmp]);
        delete require.cache[require.resolve("../../preload/index.js")];
        require("../../preload/index.js");
        const bridge = window.inkpointNodeBridge!;
        const workspace = bridge.pickWorkspace()!;
        expect(() => bridge.deleteWorkspaceItem(workspace.tree.id)).toThrow(
          "请选择已授权工作区内的项目",
        );
        const file = bridge.createWorkspaceItem(workspace.tree.id, "my-doc", "markdown");
        const dir = bridge.createWorkspaceItem(workspace.tree.id, "notes", "directory");
        const node = (target: string) =>
          bridge.refreshWorkspace().tree.children!.find((n) => n.path === target)!;
        const nested = bridge.createWorkspaceItem(node(dir).id, "sub-note.md", "markdown");
        expect(fs.existsSync(nested)).toBe(true);
        const fileNode = node(file);
        expect(() => bridge.renameWorkspaceItem(fileNode.id, "../outside.md")).toThrow(
          "无效的文件或文件夹名称",
        );
        const renamed = bridge.renameWorkspaceItem(fileNode.id, "renamed.md");
        expect(fs.existsSync(file)).toBe(false);
        bridge.deleteWorkspaceItem(node(renamed).id);
        bridge.deleteWorkspaceItem(node(dir).id);
        expect(fs.readdirSync(tmp)).toEqual([]);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("Referral URL", () => {
    it("generates correct UTM tracking parameters and targets official site", () => {
      const url = buildReferralUrl("top_banner");
      expect(url.startsWith("https://editor.jiaqi.im")).toBe(true);
      expect(url).toContain("utm_source=utools");
      expect(url).toContain("utm_medium=plugin");
      expect(url).toContain("utm_campaign=top_banner");
    });
  });

  describe("Document State Save & Path Operations (Anti-Jump Regression)", () => {
    it("settles save without incrementing documentGeneration, preserving editor view state", () => {
      const doc = createDocumentState({
        markdown: "# Initial",
        filePath: "/mock/doc.md",
      });
      const initialSnap = doc.getSnapshot();
      expect(initialSnap.documentGeneration).toBe(1);

      // Simulate edit
      doc.applyEditorChange("# Initial modified", {
        kind: "renderer",
        clientId: "test-client",
        sequence: 1,
      });
      expect(doc.getSnapshot().isDirty).toBe(true);
      expect(doc.getSnapshot().documentGeneration).toBe(1);

      // Save using beginSave + settleSave
      const checkpoint = doc.beginSave({
        kind: "current-path",
        path: "/mock/doc.md",
      });
      const settleResult = doc.settleSave(checkpoint, {
        status: "succeeded",
        commit: "committed",
        filePath: "/mock/doc.md",
        warnings: [],
      });

      expect(settleResult.status).toBe("applied");
      const postSaveSnap = doc.getSnapshot();
      expect(postSaveSnap.isDirty).toBe(false);
      // documentGeneration MUST stay the same to avoid triggering #installDocumentBoundary (which resets scrollTop to 0)
      expect(postSaveSnap.documentGeneration).toBe(initialSnap.documentGeneration);
      expect(postSaveSnap.savedMarkdown).toBe("# Initial modified");
    });

    it("renames file via setDocumentPath without incrementing documentGeneration", () => {
      const doc = createDocumentState({
        markdown: "# Note",
        filePath: "/mock/old.md",
      });
      const snap = doc.getSnapshot();
      const result = doc.setDocumentPath({
        filePath: "/mock/new.md",
        expectedGeneration: snap.documentGeneration,
        expectedStateRevision: snap.stateRevision,
        origin: { kind: "command", commandId: "file.rename" },
      });

      expect(result.status).toBe("applied");
      expect(doc.getSnapshot().filePath).toBe("/mock/new.md");
      expect(doc.getSnapshot().documentGeneration).toBe(snap.documentGeneration);
    });
  });
});
