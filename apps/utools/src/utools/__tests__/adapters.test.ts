// apps/utools/src/utools/__tests__/adapters.test.ts
// uTools 适配层单元测试

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUtoolsFileAdapter, createUtoolsNativeSaveAdapter } from "../file-adapter";
import {
  saveLastOpenedFile,
  loadLastOpenedFile,
  clearLastOpenedFile,
  LAST_OPENED_FILE_KEY,
  saveLastOpenedFolder,
  loadLastOpenedFolder,
  clearLastOpenedFolder,
  LAST_WORKSPACE_KEY,
  loadUtoolsSettings,
  saveUtoolsSettings,
  DEFAULT_UTOOLS_SETTINGS,
} from "../db-storage";
import {
  resolveProseFontStack,
  resolveCodeFontStack,
  PROSE_FONT_OPTIONS,
  CODE_FONT_OPTIONS,
} from "../fonts";
import { hasAcceptedAiDisclaimer, acceptAiDisclaimer, resetAiDisclaimer } from "../ai-disclaimer";
import { buildReferralUrl } from "../referral";
import type { NativeFileSaveJob } from "@md-editor/file-system";

describe("uTools Platform Adapters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Ensure window exists in node test environment
    (globalThis as unknown as { window: unknown }).window = globalThis;

    // Mock window.inkpointNodeBridge
    const mockFolder = {
      rootPath: "/mock/workspace",
      rootName: "workspace",
      tree: {
        name: "workspace",
        path: "/mock/workspace",
        kind: "directory" as const,
        children: [
          { name: "README.md", path: "/mock/workspace/README.md", kind: "markdown" as const },
        ],
      },
    };

    window.inkpointNodeBridge = {
      readFile: vi.fn((path: string) => `# Mock content of ${path}`),
      writeFile: vi.fn(),
      exists: vi.fn(() => true),
      getDirname: vi.fn((_path: string) => "/mock/dir"),
      getBasename: vi.fn((_path: string) => "file.md"),
      isDirectory: vi.fn((path: string) => path === "/mock/workspace"),
      scanFolder: vi.fn(() => mockFolder),
      createTreeItem: vi.fn((parent: string, name: string) => `${parent}/${name}`),
      renameTreeItem: vi.fn((oldPath: string, name: string) => `/mock/${name}`),
      deleteTreeItem: vi.fn(),
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
      const file = await adapter.readMarkdownFile("/mock/note.md");

      expect(file.filePath).toBe("/mock/note.md");
      expect(file.markdown).toBe("# Mock content of /mock/note.md");
      expect(window.inkpointNodeBridge?.readFile).toHaveBeenCalledWith("/mock/note.md");
    });

    it("opens markdown file via utools dialog", async () => {
      const adapter = createUtoolsFileAdapter();
      const file = await adapter.openMarkdownFile();

      expect(file).not.toBeNull();
      expect(file?.filePath).toBe("/mock/test.md");
      expect(window.utools.showOpenDialog).toHaveBeenCalled();
    });

    it("opens markdown folder via utools dialog and scans folder tree", async () => {
      vi.mocked(window.utools.showOpenDialog).mockReturnValueOnce(["/mock/workspace"]);
      const adapter = createUtoolsFileAdapter();
      const folder = await adapter.openMarkdownFolder();

      expect(folder).not.toBeNull();
      expect(folder?.rootPath).toBe("/mock/workspace");
      expect(window.inkpointNodeBridge?.scanFolder).toHaveBeenCalledWith("/mock/workspace");
    });

    it("creates, renames and deletes tree items", async () => {
      const adapter = createUtoolsFileAdapter();
      const createRes = await adapter.createMarkdownTreeItem({
        rootPath: "/mock/workspace",
        parentPath: "/mock/workspace",
        name: "test.md",
        kind: "markdown",
      });
      expect(createRes.affectedPath).toBe("/mock/workspace/test.md");
      expect(window.inkpointNodeBridge?.createTreeItem).toHaveBeenCalled();

      const renameRes = await adapter.renameMarkdownTreeItem({
        rootPath: "/mock/workspace",
        path: "/mock/workspace/test.md",
        name: "renamed.md",
      });
      expect(renameRes.affectedPath).toBe("/mock/renamed.md");
      expect(window.inkpointNodeBridge?.renameTreeItem).toHaveBeenCalled();

      const deleteRes = await adapter.deleteMarkdownTreeItem({
        rootPath: "/mock/workspace",
        path: "/mock/workspace/test.md",
      });
      expect(deleteRes.affectedPath).toBeNull();
      expect(window.inkpointNodeBridge?.deleteTreeItem).toHaveBeenCalled();
    });

    it("handles save job to existing path", async () => {
      const saveAdapter = createUtoolsNativeSaveAdapter();
      const job: NativeFileSaveJob = {
        jobId: "job-1",
        checkpointSequence: 1,
        documentGeneration: 1,
        markdownLf: "# Hello Save",
        destination: { kind: "current-path", path: "/mock/save.md" },
        orderingToken: { epoch: 1, id: 1, runtimeSequence: 1 },
      };

      const outcome = await saveAdapter.saveMarkdownJob(job);
      expect(outcome).toEqual({
        status: "committed",
        runtimeSequence: 1,
        filePath: "/mock/save.md",
        warnings: [],
      });
      expect(window.inkpointNodeBridge?.writeFile).toHaveBeenCalledWith(
        "/mock/save.md",
        "# Hello Save",
      );
    });

    it("handles user cancelling save dialog", async () => {
      vi.mocked(window.utools.showSaveDialog).mockReturnValueOnce(undefined as unknown as string);
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

  describe("Local File & Workspace Persistence", () => {
    it("saves, loads and clears last opened file", () => {
      saveLastOpenedFile("/mock/documents/my-note.md");
      expect(window.utools.dbStorage.setItem).toHaveBeenCalledWith(
        LAST_OPENED_FILE_KEY,
        "/mock/documents/my-note.md",
      );

      const loaded = loadLastOpenedFile();
      expect(loaded).toBe("/mock/documents/my-note.md");

      clearLastOpenedFile();
      expect(window.utools.dbStorage.removeItem).toHaveBeenCalledWith(LAST_OPENED_FILE_KEY);
    });

    it("saves, loads and clears last opened workspace folder", () => {
      saveLastOpenedFolder("/mock/my-project");
      expect(window.utools.dbStorage.setItem).toHaveBeenCalledWith(
        LAST_WORKSPACE_KEY,
        "/mock/my-project",
      );

      const loaded = loadLastOpenedFolder();
      expect(loaded).toBe("/mock/my-project");

      clearLastOpenedFolder();
      expect(window.utools.dbStorage.removeItem).toHaveBeenCalledWith(LAST_WORKSPACE_KEY);
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
      };
      saveUtoolsSettings(updated);

      const loaded = loadUtoolsSettings();
      expect(loaded.theme).toBe("dark");
      expect(loaded.fontSize).toBe(18);
      expect(loaded.proseFontFamily).toBe("lxgw-wenkai");
      expect(loaded.codeFontFamily).toBe("jetbrains-mono");
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

  describe("Image Path Resolution (Preload Bridge)", () => {
    it("handles remote URLs, data URLs and resolves local image files to base64 Data URLs", () => {
      // Load real preload implementation into window
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");

      // Save previous bridge
      const prevBridge = window.inkpointNodeBridge;
      require("../../../preload/index.js");

      const bridge = window.inkpointNodeBridge!;
      expect(bridge.resolveImageSrc).toBeDefined();

      // Remote & data URLs untouched
      expect(bridge.resolveImageSrc!("/doc/path.md", "https://example.com/pic.png")).toBe(
        "https://example.com/pic.png",
      );
      expect(
        bridge.resolveImageSrc!("/doc/path.md", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="),
      ).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");

      // Create a temporary directory structure
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-img-test-"));
      const docPath = path.join(tmpDir, "docs", "note.md");
      const assetsDir = path.join(tmpDir, "docs", "assets");
      fs.mkdirSync(assetsDir, { recursive: true });

      const testImgPath = path.join(assetsDir, "test image.png");
      fs.writeFileSync(testImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

      // Relative path with encoding, angle brackets and query
      const resolved = bridge.resolveImageSrc!(
        docPath,
        "<assets/test%20image.png?v=123#center>",
        tmpDir,
      );
      expect(resolved.startsWith("data:image/png;base64,")).toBe(true);

      // Non-existent image returns original src
      expect(bridge.resolveImageSrc!(docPath, "assets/non-existent.png", tmpDir)).toBe(
        "assets/non-existent.png",
      );

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
      window.inkpointNodeBridge = prevBridge;
    });
  });

  describe("File Tree Item Operations (Preload Bridge)", () => {
    it("creates files and directories, renames, scans and deletes items", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");

      const prevBridge = window.inkpointNodeBridge;
      delete require.cache[require.resolve("../../../preload/index.js")];
      require("../../../preload/index.js");
      const bridge = window.inkpointNodeBridge!;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-tree-test-"));

      // 1. Create a markdown file
      const createdFile = bridge.createTreeItem(tmpDir, "my-doc", "markdown");
      expect(createdFile).toBe(path.join(tmpDir, "my-doc.md"));
      expect(fs.existsSync(createdFile)).toBe(true);

      // 2. Create a subfolder
      const createdSubdir = bridge.createTreeItem(tmpDir, "notes", "directory");
      expect(createdSubdir).toBe(path.join(tmpDir, "notes"));
      expect(fs.statSync(createdSubdir).isDirectory()).toBe(true);

      // 3. Create nested file inside subfolder
      const nestedFile = bridge.createTreeItem(createdSubdir, "sub-note.md", "markdown");
      expect(fs.existsSync(nestedFile)).toBe(true);

      // 4. Scan folder
      const scanned = bridge.scanFolder(tmpDir);
      expect(scanned.rootPath).toBe(tmpDir);
      expect(scanned.tree.children?.length).toBe(2);

      // 5. Rename file
      const renamedFile = bridge.renameTreeItem(createdFile, "renamed-doc.md");
      expect(fs.existsSync(renamedFile)).toBe(true);
      expect(fs.existsSync(createdFile)).toBe(false);

      // 6. Delete file and folder
      bridge.deleteTreeItem(renamedFile);
      expect(fs.existsSync(renamedFile)).toBe(false);

      bridge.deleteTreeItem(createdSubdir);
      expect(fs.existsSync(createdSubdir)).toBe(false);

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
      window.inkpointNodeBridge = prevBridge;
    });
  });

  describe("Referral URL", () => {
    it("generates correct UTM tracking parameters and targets official site", () => {
      const url = buildReferralUrl("top_banner");
      expect(url.startsWith("https://editor.justdev.cn")).toBe(true);
      expect(url).toContain("utm_source=utools");
      expect(url).toContain("utm_medium=plugin");
      expect(url).toContain("utm_campaign=top_banner");
    });
  });
});
