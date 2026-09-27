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
    const shell = createFullscreenShell({
      terminal: new FakeTerminal(),
      initialText: "hello\nworld",
    });
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
    // 「光标回到上方要滚回去」由 nextScrollTop 的纯函数用例覆盖（headless 下 scrollTop 恒为 0）
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

describe("状态栏在真实帧布局里的位置（回归：basis 缺失会被 shrink 挤成 0 行）", () => {
  it("24 行终端下状态栏写在第 24 行，正文只占前 23 行", async () => {
    const terminal = new FakeTerminal();
    terminal.rows = 24;
    const shell = createFullscreenShell({
      terminal,
      initialText: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"),
    });
    shell.start();
    try {
      await vi.waitFor(() => {
        expect(terminal.writes.join("")).toContain("NORMAL");
      });
    } finally {
      shell.stop();
    }

    // 状态栏必须落在第 24 行（终端最后一行）：旧实现里 ScrollView 没给 basis:0，
    // 初始尺寸取整篇内容高度 → 按比例 shrink 后状态栏被挤成 0 行，永远看不见。
    const ESC = String.fromCharCode(27);
    const out = terminal.writes.join("");
    const lastRow24 = out.lastIndexOf(`${ESC}[24;1H`);
    expect(lastRow24).toBeGreaterThan(-1);
    // 第 24 行紧邻转义之后写下的文本（跳过清行序列）
    const row24Text = out.slice(lastRow24).split(ESC).slice(1, 3).join("");
    expect(row24Text).toContain("NORMAL");
    // 正文不能占用第 24 行（否则就是状态栏被挤掉的症状）
    expect(row24Text).not.toContain("line ");
  });

  it("状态栏列号用显示列（CJK/emoji 双宽），不是 grapheme 序号", () => {
    const shell = createFullscreenShell({ terminal: new FakeTerminal(), initialText: "中文ab" });
    // 光标停在「中文」之后：grapheme 序号 3，显示列 5（1 基）
    for (const key of ["l", "l"]) shell.editor.handleInput(key);
    const line = shell.statusBar.render(80)[0];
    expect(line).toContain("1:5");
    expect(line).not.toContain("1:3");
  });
});

describe("壳子写盘失败路径", () => {
  it("状态栏报错、脏标记保留、错误回调照常触发", () => {
    const errors: unknown[] = [];
    const shell = createFullscreenShell({
      terminal: new FakeTerminal(),
      filePath: "/proc/definitely-not-writable.md",
      initialText: "data",
      onError: (error) => errors.push(error),
    });
    shell.editor.handleInput("x");
    for (const key of [":", "w", "\r"]) shell.editor.handleInput(key);

    expect(shell.editor.dirty).toBe(true);
    expect(shell.statusBar.render(80)[0]).toContain("保存失败");
    expect(errors).toHaveLength(1);
  });
});
