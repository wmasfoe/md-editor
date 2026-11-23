import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyDocumentAsHtml } from "../src/app/controller/export-controller";

const { mockInvoke, mockSave } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSave: vi.fn(),
}));

/**
 * 让 `mockInvoke` 对 Rust 渲染命令返回可用的 HTML，其余命令按测试自身设定。
 *
 * 渲染已迁到 Rust（`render_markdown_fragment` / `render_markdown_document_from_fragment`），
 * 前端只负责 mermaid/图片后处理与文档包装，因此这里模拟 Rust 的返回。
 */
function stubRenderCommands() {
  mockInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "render_markdown_fragment") {
      const markdown = String(args?.markdown ?? "");
      // 只保留段落与标题的最小可辨识输出，足以断言后处理行为
      const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
      const body = markdown
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .map((line) => `<p>${line.trim()}</p>`)
        .join("");
      return `${heading ? `<h1 id="t" data-heading-text="${heading}">${heading}</h1>` : ""}${body}`;
    }
    if (command === "render_markdown_document_from_fragment") {
      const fragment = String(args?.fragment ?? "");
      const customCss = String(args?.customCss ?? "");
      return `<!doctype html><html><head><style>${customCss}</style></head><body><div id="content">${fragment}</div></body></html>`;
    }
    return undefined;
  });
}

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mockSave,
}));

describe("export-controller", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSave.mockReset();
    stubRenderCommands();
  });

  it("copies rich text html to clipboard using ClipboardItem", async () => {
    let writtenItems: unknown[] = [];
    const writeMock = vi.fn(async (items: unknown[]) => {
      writtenItems = items;
    });

    class MockClipboardItem {
      readonly data: Record<string, unknown>;
      constructor(data: Record<string, unknown>) {
        this.data = data;
      }
    }

    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("navigator", {
      clipboard: {
        write: writeMock,
      },
    });

    const md = "# Test Title\n\nThis is a **bold** paragraph.";
    const result = await copyDocumentAsHtml(md);

    expect(result).toBe(true);
    expect(writeMock).toHaveBeenCalledOnce();
    expect(writtenItems.length).toBe(1);

    vi.unstubAllGlobals();
  });

  it("falls back to writeText when ClipboardItem is unavailable", async () => {
    let writtenText = "";
    const writeTextMock = vi.fn(async (text: string) => {
      writtenText = text;
    });

    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const md = "Hello world";
    const result = await copyDocumentAsHtml(md);

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledOnce();
    expect(writtenText).toContain("<p>Hello world</p>");

    vi.unstubAllGlobals();
  });

  it("handles PDF export cancellation gracefully", async () => {
    mockSave.mockResolvedValueOnce(null);

    const { exportDocumentAsPdf } = await import("../src/app/controller/export-controller");
    const result = await exportDocumentAsPdf(null, "# Cancelled Doc");
    expect(result.success).toBe(false);
    expect(result.message).toBe("已取消导出");
  });

  it("exports PDF directly to selected path when save dialog is confirmed", async () => {
    mockSave.mockResolvedValueOnce("/Users/test/Documents/my-doc.pdf");

    const { exportDocumentAsPdf } = await import("../src/app/controller/export-controller");
    const result = await exportDocumentAsPdf("/Users/test/Documents/my-doc.md", "# Valid Doc");

    expect(result.success).toBe(true);
    expect(result.filePath).toBe("/Users/test/Documents/my-doc.pdf");
    expect(mockInvoke).toHaveBeenCalledWith(
      "export_html_to_pdf",
      expect.objectContaining({
        html: expect.stringContaining("Valid Doc"),
        outputPath: "/Users/test/Documents/my-doc.pdf",
        pageSize: "A4",
        orientation: "portrait",
      }),
    );
  });

  it("falls back to print preview when backend PDF export fails", async () => {
    mockSave.mockResolvedValueOnce("/Users/test/Documents/fallback.pdf");
    // 只让落盘命令失败，渲染命令仍走正常 stub
    const base = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "export_html_to_pdf") {
        throw new Error("Native engine error");
      }
      return base?.(command, args);
    });

    vi.stubGlobal("document", {
      createElement: () => ({
        style: {},
        contentWindow: { focus: vi.fn(), print: vi.fn() },
        addEventListener: (_event: string, cb: () => void) => cb(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    const { exportDocumentAsPdf } = await import("../src/app/controller/export-controller");
    const result = await exportDocumentAsPdf(null, "# Fallback Doc");

    expect(result.success).toBe(true);
    expect(result.message).toContain("系统打印");

    vi.unstubAllGlobals();
  });

  it("resolves export styling from app settings with fonts and theme CSS", async () => {
    const { resolveExportStyling } = await import("../src/app/controller/export-controller");
    const { createDefaultSettings } = await import("../src/app/settings/persistence/storage");

    const defaultSettings = createDefaultSettings();
    const customSettings = {
      ...defaultSettings,
      editor: {
        ...defaultSettings.editor,
        proseFontFamily: "lxgw-wenkai",
        codeFontFamily: "jetbrains-mono",
        wysiwygFontSize: 18,
      },
    };

    const styling = resolveExportStyling(customSettings);
    expect(styling.proseFontFamily).toContain("LXGW WenKai");
    expect(styling.codeFontFamily).toContain("JetBrains Mono");
    expect(styling.fontSize).toBe(18);
    expect(styling.themeCss).toBeDefined();
    expect(styling.isDark).toBe(false);
  });

  it("leaves proseFontFamily undefined when following theme default so theme font stack is preserved", async () => {
    const { resolveExportStyling } = await import("../src/app/controller/export-controller");
    const { createDefaultSettings } = await import("../src/app/settings/persistence/storage");

    const defaultSettings = createDefaultSettings();
    const styling = resolveExportStyling(defaultSettings);
    expect(styling.proseFontFamily).toBeUndefined();
    expect(styling.codeFontFamily).toBeUndefined();
    expect(styling.themeCss).toBeDefined();
  });

  it("passes styling and fonts into generated PDF export HTML", async () => {
    mockSave.mockResolvedValueOnce("/Users/test/Documents/styled.pdf");

    const { exportDocumentAsPdf } = await import("../src/app/controller/export-controller");
    const result = await exportDocumentAsPdf("/Users/test/Documents/styled.md", "# Styled Doc", {
      pageSize: "A4",
      orientation: "portrait",
      proseFontFamily: "LXGW WenKai, sans-serif",
      codeFontFamily: "JetBrains Mono, monospace",
      fontSize: 18,
    });

    expect(result.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      "export_html_to_pdf",
      expect.objectContaining({
        outputPath: "/Users/test/Documents/styled.pdf",
        html: expect.stringMatching(/--theme-font:\s*LXGW WenKai/),
      }),
    );
  });
});
