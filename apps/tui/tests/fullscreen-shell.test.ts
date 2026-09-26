import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURSOR_MARKER, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFullscreenShell, nextScrollTop } from "../src/shell/fullscreen.ts";

/** 假终端：捕获写入、不真的启动 raw mode（集成测试用） */
class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  writes: string[] = [];
  started = false;

  start(): void {
    this.started = true;
  }
  stop(): void {
    this.started = false;
  }
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

function stripMarkers(lines: string[]): string[] {
  return lines.map((line) => line.split(CURSOR_MARKER).join(""));
}

describe("fullscreen shell", () => {
  let workDir = "";

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "inkpoint-tui-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("mounts the editor plus a status bar and focuses the editor", () => {
    const shell = createFullscreenShell({ terminal: new FakeTerminal(), initialText: "hello\nworld" });
    const lines = shell.tui.render(60);
    const stripped = stripMarkers(lines);
    expect(stripped.some((line) => line.includes("hello"))).toBe(true);
    expect(stripped[stripped.length - 1]).toContain("NORMAL");
    expect(shell.editor.focused).toBe(true);
  });

  it("keeps the status bar on the last line and shows the mode", () => {
    const shell = createFullscreenShell({ terminal: new FakeTerminal(), initialText: "x" });
    shell.editor.handleInput("i");
    const lines = stripMarkers(shell.tui.render(60));
    expect(lines[lines.length - 1]).toContain("INSERT");
  });

  it("writes the buffer to disk on :w", () => {
    const target = join(workDir, "doc.md");
    const shell = createFullscreenShell({
      terminal: new FakeTerminal(),
      initialText: "before",
      filePath: target,
    });
    shell.editor.handleInput("i");
    shell.editor.handleInput("X");
    shell.editor.handleInput("\x1b");
    for (const key of [":", "w", "\r"]) shell.editor.handleInput(key);
    expect(readFileSync(target, "utf8")).toBe("Xbefore");
    expect(shell.editor.dirty).toBe(false);
  });

  it("falls back to untitled.md when no path was given", () => {
    const shell = createFullscreenShell({ terminal: new FakeTerminal(), initialText: "draft" });
    const previous = process.cwd();
    process.chdir(workDir);
    try {
      for (const key of [":", "w", "\r"]) shell.editor.handleInput(key);
      expect(readFileSync(join(workDir, "untitled.md"), "utf8")).toBe("draft");
      expect(shell.editor.filePath).toBe("untitled.md");
    } finally {
      process.chdir(previous);
    }
  });

  it("asks the scroll view to follow the cursor", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const shell = createFullscreenShell({ terminal: new FakeTerminal(), initialText: text });
    const scrollTo = vi.spyOn(shell.scrollView, "scrollTo");

    // 视口内移动：不请求滚动
    shell.editor.handleInput("j");
    shell.followCursor(10);
    expect(scrollTo).not.toHaveBeenCalled();

    // 光标越出视口底部：请求把视口顶到能显示光标的位置
    for (let i = 0; i < 40; i++) shell.editor.handleInput("j");
    scrollTo.mockClear();
    shell.followCursor(10);
    expect(scrollTo).toHaveBeenCalledWith(32); // 光标在第 42 行（0 基 41），视口高 10
    expect(shell.editor.getCursorInfo().line).toBe(42);

    // 光标回顶部：请求滚回 0
    shell.editor.handleInput("g");
    shell.editor.handleInput("g");
    scrollTo.mockClear();
    shell.followCursor(10);
    expect(scrollTo).toHaveBeenCalledWith(0);
  });

  it("computes cursor-driven scrolling with vim scrolloff=0 semantics", () => {
    expect(nextScrollTop(0, 10, 5)).toBe(0); // 视口内不动
    expect(nextScrollTop(0, 10, 10)).toBe(1); // 越出底部一行
    expect(nextScrollTop(20, 10, 5)).toBe(5); // 越出顶部 → 顶到光标
    expect(nextScrollTop(0, 0, 99)).toBe(0); // 视口高度未知 → 不滚动
  });

  it("renders every line within the terminal width", () => {
    const shell = createFullscreenShell({
      terminal: new FakeTerminal(),
      initialText: "很长的一行中文内容".repeat(20),
    });
    for (const line of shell.tui.render(40)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });
});
