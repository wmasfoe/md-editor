import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import type { execFileSync as ExecFileSyncType } from "node:child_process";
import { copyDocumentAsHtml } from "../src/app/controller/export-controller";

const { mockInvoke, mockSave } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSave: vi.fn(),
}));

/**
 * 让 `mockInvoke` 对 Rust 渲染命令走**真实渲染实现**，其余命令由测试自行设定。
 *
 * 为什么不用手写 HTML stub：手写 stub 会让「导出丢失行内强调」「标题硬编码为
 * Untitled」这类回归在测试里完全不可见（历史教训）。这里把渲染命令转发给
 * `crates/render`（经 `scripts/render-diff` 的同一个 Rust 入口），
 * 保证断言的是真实管线行为。
 */
function stubRenderCommands() {
  mockInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "render_markdown_fragment") {
      return renderRustFragment(String(args?.markdown ?? ""), args?.includeMarkers === true);
    }
    if (command === "render_markdown_document_from_fragment") {
      const fragment = String(args?.fragment ?? "");
      const customCss = String(args?.customCss ?? "");
      const title = String(args?.title ?? "Untitled");
      return renderRustDocument(fragment, customCss, title);
    }
    return undefined;
  });
}

/**
 * 通过 Rust 渲染核心产出片段。
 *
 * 直接调用 `cargo run --example` 太慢，这里复用 `render-fixtures` 的批量入口太重；
 * 因此用一个精简的 example（`render-fragment`）做单次调用。
 */
function renderRustFragment(markdown: string, includeMarkers: boolean): string {
  return runRustExample("render-fragment", {
    markdown,
    includeMarkers,
  });
}

/** 通过 Rust 渲染核心包装文档。 */
function renderRustDocument(fragment: string, customCss: string, title: string): string {
  return runRustExample("render-document", { fragment, customCss, title });
}

/** 调用 crates/render 的 example，返回 stdout。 */
function runRustExample(example: string, payload: unknown): string {
  const { execFileSync } = createRequire(import.meta.url)("node:child_process") as {
    execFileSync: typeof ExecFileSyncType;
  };
  const repoRoot = path.resolve(__dirname, "../../..");
  return execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      path.join(repoRoot, "crates/render/Cargo.toml"),
      "--example",
      example,
    ],
    { cwd: repoRoot, input: JSON.stringify(payload), encoding: "utf8" },
  );
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
    // 复制到富文本编辑器的是**完整文档**：必须带主题变量与 <style>，
    // 否则粘贴后丢失全部排版（回归项）。
    expect(writtenText).toContain("<!doctype html>");
    expect(writtenText).toContain("<style>");
    expect(writtenText).toContain("--theme-bg");

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

  it("导出的 HTML 保留行内强调语义（导出路径用 includeMarkers:false）", async () => {
    // 回归背景：Rust 侧曾在该模式下丢掉 <strong>/<em>/<del>/<mark>，
    // 导致「复制为富文本 / 导出 HTML / 导出 PDF」全部丢失行内强调。
    const md = "# 项目说明\n\n这段包含 **加粗**、*斜体*、~~删除线~~ 与 ==高亮==。";

    mockSave.mockResolvedValueOnce("/Users/test/Documents/emphasis.html");
    const { exportDocumentAsHtml } = await import("../src/app/controller/export-controller");
    const result = await exportDocumentAsHtml(null, md);
    expect(result.success).toBe(true);

    const writeCall = mockInvoke.mock.calls.find(([command]) => command === "write_exported_files");
    expect(writeCall).toBeDefined();
    const written = Object.values(writeCall![1].files as Record<string, string>)[0];

    expect(written).toContain("<strong>加粗</strong>");
    expect(written).toContain("<em>斜体</em>");
    expect(written).toContain("<del>删除线</del>");
    expect(written).toContain("<mark>高亮</mark>");
    // 正文里不应出现编辑器语法标记的 span（注意：内联 CSS 里保留
    // `.cm-md-marker` 样式规则是既有行为，与 TS 侧一致，不算泄漏）。
    const content = written.slice(written.indexOf('<div id="content">'));
    expect(content).not.toContain('class="cm-md-marker');
  });

  it("导出的 HTML 标题取自正文 H1，而不是硬编码 Untitled", async () => {
    // 回归背景：render_markdown_document_from_fragment 曾硬编码 "Untitled"，
    // 且前端不传 title，导致所有导出文件的 <title> 都是 Untitled。
    mockSave.mockResolvedValueOnce("/Users/test/Documents/title.html");
    const { exportDocumentAsHtml } = await import("../src/app/controller/export-controller");
    await exportDocumentAsHtml(null, "# 项目说明\n\n正文。");

    const writeCall = mockInvoke.mock.calls.find(([command]) => command === "write_exported_files");
    const written = Object.values(writeCall![1].files as Record<string, string>)[0];

    expect(written).toContain("<title>项目说明</title>");
    expect(written).not.toContain("<title>Untitled</title>");
  });
});
