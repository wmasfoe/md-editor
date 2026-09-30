import { describe, expect, it } from "vitest";
import { TextDocument } from "../src/document/text-document.ts";
import { MdDocumentView } from "../src/render/md-view.ts";
import {
  colorSchemeFromRgb,
  darkTheme,
  defaultTheme,
  detectEnvironmentColorScheme,
  getThemeByColorScheme,
  lightTheme,
} from "../src/render/theme.ts";
import { parseCliArgs } from "../src/cli.ts";
import { MdEditor } from "../src/editor/md-editor.ts";
import { createFullscreenShell } from "../src/shell/fullscreen.ts";
import type { Terminal } from "@earendil-works/pi-tui";

class MockTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  writes: string[] = [];
  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return Promise.resolve();
  }
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

describe("theme definitions", () => {
  it("defaultTheme is darkTheme for backward compatibility", () => {
    expect(defaultTheme).toBe(darkTheme);
  });

  it("darkTheme uses warm gold-yellow tones suitable for dark backgrounds", () => {
    expect(darkTheme.heading(1, "H1")).toContain("\x1b[1;38;5;214m");
    expect(darkTheme.heading(2, "H2")).toContain("\x1b[1;38;5;220m");
    expect(darkTheme.heading(3, "H3")).toContain("\x1b[1;38;5;228m");
    expect(darkTheme.bullet("•")).toContain("\x1b[33m");
    expect(darkTheme.code("code")).toContain("\x1b[36m");
  });

  it("lightTheme uses high-contrast burnt orange, deep amber and bronze tones for light backgrounds", () => {
    const h1 = lightTheme.heading(1, "H1");
    const h2 = lightTheme.heading(2, "H2");
    const h3 = lightTheme.heading(3, "H3");

    // 焦橙、深琥珀、古铜色
    expect(h1).toContain("\x1b[1;38;5;166m");
    expect(h2).toContain("\x1b[1;38;5;130m");
    expect(h3).toContain("\x1b[1;38;5;94m");

    // 亮色主题下严禁使用浅黄色（220/228/33），否则在白底完全无法看清
    expect(h1).not.toContain("228m");
    expect(h2).not.toContain("228m");
    expect(h3).not.toContain("228m");
    expect(lightTheme.bullet("•")).not.toContain("\x1b[33m");
    expect(lightTheme.bullet("•")).toContain("\x1b[38;5;130m");

    // 代码块与链接也使用适合浅底的深青与深蓝
    expect(lightTheme.code("code")).toContain("\x1b[38;5;30m");
    expect(lightTheme.link("link")).toContain("\x1b[4;38;5;25m");
  });

  it("getThemeByColorScheme returns corresponding theme", () => {
    expect(getThemeByColorScheme("dark")).toBe(darkTheme);
    expect(getThemeByColorScheme("light")).toBe(lightTheme);
  });
});

describe("colorSchemeFromRgb", () => {
  it("determines light vs dark correctly based on relative luminance", () => {
    // 纯白、浅灰 → light
    expect(colorSchemeFromRgb({ r: 255, g: 255, b: 255 })).toBe("light");
    expect(colorSchemeFromRgb({ r: 240, g: 240, b: 240 })).toBe("light");
    expect(colorSchemeFromRgb({ r: 200, g: 200, b: 200 })).toBe("light");

    // 纯黑、深灰、暗青 → dark
    expect(colorSchemeFromRgb({ r: 0, g: 0, b: 0 })).toBe("dark");
    expect(colorSchemeFromRgb({ r: 30, g: 30, b: 30 })).toBe("dark");
    expect(colorSchemeFromRgb({ r: 24, g: 30, b: 40 })).toBe("dark");
  });
});

describe("detectEnvironmentColorScheme", () => {
  it("prefers explicit INK_THEME variable", () => {
    expect(detectEnvironmentColorScheme({ INK_THEME: "light" })).toBe("light");
    expect(detectEnvironmentColorScheme({ INK_THEME: "dark" })).toBe("dark");
  });

  it("reads TERM_BACKGROUND variable", () => {
    expect(detectEnvironmentColorScheme({ TERM_BACKGROUND: "light" })).toBe("light");
    expect(detectEnvironmentColorScheme({ TERM_BACKGROUND: "dark" })).toBe("dark");
  });

  it("parses COLORFGBG variable correctly", () => {
    // 0;15 -> 背景是 15 (亮白) -> light
    expect(detectEnvironmentColorScheme({ COLORFGBG: "0;15" })).toBe("light");
    // 15;0 -> 背景是 0 (黑色) -> dark
    expect(detectEnvironmentColorScheme({ COLORFGBG: "15;0" })).toBe("dark");
    // 0;7 -> 背景是 7 (浅灰) -> light
    expect(detectEnvironmentColorScheme({ COLORFGBG: "0;7" })).toBe("light");
    // 7;0 -> 背景是 0 (黑色) -> dark
    expect(detectEnvironmentColorScheme({ COLORFGBG: "7;0" })).toBe("dark");
  });

  it("defaults to dark when no signals are available", () => {
    expect(detectEnvironmentColorScheme({ VITEST: "true" })).toBe("dark");
  });
});

describe("parseCliArgs", () => {
  it("parses empty args to defaults", () => {
    expect(parseCliArgs([])).toEqual({
      filePath: null,
      colorScheme: "auto",
      showHelp: false,
    });
  });

  it("parses positional markdown file path", () => {
    expect(parseCliArgs(["README.md"])).toEqual({
      filePath: "README.md",
      colorScheme: "auto",
      showHelp: false,
    });
  });

  it("parses --light and --dark flags", () => {
    expect(parseCliArgs(["--light", "note.md"])).toEqual({
      filePath: "note.md",
      colorScheme: "light",
      showHelp: false,
    });
    expect(parseCliArgs(["note.md", "--dark"])).toEqual({
      filePath: "note.md",
      colorScheme: "dark",
      showHelp: false,
    });
  });

  it("parses --theme option", () => {
    expect(parseCliArgs(["--theme", "light", "doc.md"])).toEqual({
      filePath: "doc.md",
      colorScheme: "light",
      showHelp: false,
    });
    expect(parseCliArgs(["--theme", "dark", "doc.md"])).toEqual({
      filePath: "doc.md",
      colorScheme: "dark",
      showHelp: false,
    });
  });

  it("parses --help flag", () => {
    expect(parseCliArgs(["--help"])).toEqual({
      filePath: null,
      colorScheme: "auto",
      showHelp: true,
    });
    expect(parseCliArgs(["-h"])).toEqual({
      filePath: null,
      colorScheme: "auto",
      showHelp: true,
    });
  });
});

describe("dynamic theme switching", () => {
  it("MdDocumentView invalidates cache and applies lightTheme when setTheme is called", () => {
    const doc = new TextDocument("# Heading 1\n## Heading 2");
    const view = new MdDocumentView(doc, darkTheme);

    const darkH1 = view.renderLine(0, { active: false });
    expect(darkH1).toContain("\x1b[1;38;5;214m");

    view.setTheme(lightTheme);
    expect(view.getTheme()).toBe(lightTheme);

    const lightH1 = view.renderLine(0, { active: false });
    expect(lightH1).toContain("\x1b[1;38;5;166m");
    expect(lightH1).not.toContain("\x1b[1;38;5;214m");
  });

  it("MdEditor delegates setTheme to view and invalidates", () => {
    const editor = new MdEditor({ initialText: "# Heading 1", theme: darkTheme });
    expect(editor.render(60)[0]).toContain("\x1b[1;38;5;214m");

    editor.setTheme(lightTheme);
    expect(editor.getTheme()).toBe(lightTheme);
    expect(editor.render(60)[0]).toContain("\x1b[1;38;5;166m");
  });

  it("createFullscreenShell supports colorScheme and dynamic setColorScheme", () => {
    const terminal = new MockTerminal();
    const shell = createFullscreenShell({
      terminal,
      initialText: "# Title",
      colorScheme: "light",
    });

    expect(shell.colorScheme).toBe("light");
    const lightLine = shell.tui.render(60)[0];
    expect(lightLine).toContain("\x1b[1;38;5;166m");

    shell.setColorScheme("dark");
    expect(shell.colorScheme).toBe("dark");
    const darkLine = shell.tui.render(60)[0];
    expect(darkLine).toContain("\x1b[1;38;5;214m");
  });
});
