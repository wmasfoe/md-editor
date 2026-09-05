// apps/utools/src/utools/__tests__/adapters.test.ts
// uTools 适配层单元测试

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUtoolsFileAdapter, createUtoolsNativeSaveAdapter } from "../file-adapter";
import { loadScratchpadFromDb, saveScratchpadToDb, SCRATCHPAD_DOC_ID } from "../db-storage";
import { hasAcceptedAiDisclaimer, acceptAiDisclaimer, resetAiDisclaimer } from "../ai-disclaimer";
import { buildReferralUrl } from "../referral";
import type { NativeFileSaveJob } from "@md-editor/file-system";

describe("uTools Platform Adapters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Ensure window exists in node test environment
    (globalThis as unknown as { window: unknown }).window = globalThis;

    // Mock window.inkpointNodeBridge
    window.inkpointNodeBridge = {
      readFile: vi.fn((path: string) => `# Mock content of ${path}`),
      writeFile: vi.fn(),
      exists: vi.fn(() => true),
      getDirname: vi.fn((_path: string) => "/mock/dir"),
      getBasename: vi.fn((_path: string) => "file.md"),
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

  describe("Database Storage (Scratchpad)", () => {
    it("saves and loads scratchpad from utools.db", () => {
      saveScratchpadToDb("## Test Note");
      const loaded = loadScratchpadFromDb();

      expect(loaded).toBe("## Test Note");
      expect(window.utools.db.put).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: SCRATCHPAD_DOC_ID,
          markdown: "## Test Note",
        }),
      );
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
