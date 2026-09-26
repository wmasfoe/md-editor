import { describe, expect, it } from "vitest";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { MdEditor, type MdEditorOptions } from "../src/editor/md-editor.ts";
import { plainTheme } from "../src/render/theme.ts";

/** 去掉 CURSOR_MARKER 后测可见宽度（模拟终端看到的内容） */
function withoutMarker(line: string): string {
  return line.split(CURSOR_MARKER).join("");
}

function markerColumn(line: string): number | null {
  const index = line.indexOf(CURSOR_MARKER);
  if (index < 0) return null;
  return visibleWidth(line.slice(0, index));
}

function makeEditor(text = "", options: MdEditorOptions = {}) {
  const editor = new MdEditor({ initialText: text, theme: plainTheme, ...options });
  editor.focused = true;
  return editor;
}

describe("MdEditor rendering", () => {
  it("renders every document line with a gutter and respects the width argument", () => {
    const editor = makeEditor("hello\nworld");
    const lines = editor.render(40);
    expect(lines).toHaveLength(2);
    expect(withoutMarker(lines[0])).toBe(" 1 hello"); // 行号 3 列宽（最少 3），右对齐
    expect(withoutMarker(lines[1])).toBe(" 2 world");
    for (const line of editor.render(12)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    }
  });

  it("truncates long lines to the given width", () => {
    const editor = makeEditor("a".repeat(100));
    expect(visibleWidth(editor.render(10)[0])).toBeLessThanOrEqual(10);
  });

  it("places the hardware cursor marker at the cursor display column", () => {
    const editor = makeEditor("中a");
    editor.handleInput("l"); // normal 模式右移一格 → 光标在 中 之后
    const line = editor.render(40)[0];
    expect(markerColumn(line)).toBe(3 + 2); // 行号 3 列 + "中" 2 列
    expect(withoutMarker(line)).toBe(" 1 中a");
  });

  it("shows the cursor line as source and styles other lines", () => {
    const editor = makeEditor("# Title\ntext");
    const lines = editor.render(40);
    expect(withoutMarker(lines[0])).toBe(" 1 # Title"); // 光标行保留源码
    expect(withoutMarker(lines[1])).toBe(" 2 text");
  });

  it("hides markers on non-cursor lines", () => {
    const editor = makeEditor("paragraph\n**bold**");
    editor.handleInput("j");
    const lines = editor.render(40);
    expect(withoutMarker(lines[1])).toBe(" 2 **bold**"); // 光标行显示源码
    expect(withoutMarker(lines[0])).toBe(" 1 paragraph");
  });

  it("does not depend on any global terminal size", () => {
    const editor = makeEditor("x".repeat(50));
    expect(editor.render(10)[0].length).toBeLessThan(editor.render(60)[0].length);
  });
});

describe("MdEditor editing", () => {
  it("starts in insert mode for an empty document and types text", () => {
    const editor = makeEditor("");
    expect(editor.mode).toBe("insert");
    editor.handleInput("h");
    editor.handleInput("i");
    expect(editor.doc.getText()).toBe("hi");
    expect(editor.dirty).toBe(true);
  });

  it("starts in normal mode for a non-empty document", () => {
    const editor = makeEditor("existing");
    expect(editor.mode).toBe("normal");
    editor.handleInput("i");
    editor.handleInput("X");
    expect(editor.doc.getText()).toBe("Xexisting");
    editor.handleInput("\x1b");
    expect(editor.mode).toBe("normal");
  });

  it("handles vim motions and dd/yy/p", () => {
    const editor = makeEditor("one\ntwo\nthree");
    editor.handleInput("j");
    expect(editor.getCursorInfo().line).toBe(2);
    editor.handleInput("d");
    editor.handleInput("d");
    expect(editor.doc.getText()).toBe("one\nthree");
    editor.handleInput("y");
    editor.handleInput("y");
    editor.handleInput("p");
    expect(editor.doc.getText()).toBe("one\nthree\nthree");
  });

  it("handles x, o and undo/redo", () => {
    const editor = makeEditor("abc");
    editor.handleInput("l");
    editor.handleInput("x");
    expect(editor.doc.getText()).toBe("ac");
    editor.handleInput("u");
    expect(editor.doc.getText()).toBe("abc");
    editor.handleInput("\x12"); // ctrl+r
    expect(editor.doc.getText()).toBe("ac");
    editor.handleInput("o");
    editor.handleInput("new");
    editor.handleInput("\x1b");
    expect(editor.doc.getText()).toBe("ac\nnew");
  });

  it("keeps the cursor inside the line in normal mode", () => {
    const editor = makeEditor("ab");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l");
    expect(editor.getCursorInfo().column).toBe(2); // 最后一个字符上，不是行尾之后
  });
});

describe("MdEditor file & quit flow", () => {
  it("saves via :w and reports through callbacks", () => {
    const saved: Array<{ text: string; path: string | null }> = [];
    const editor = makeEditor("data", {
      filePath: "/tmp/x.md",
      onSave: (text, path) => saved.push({ text, path }),
    });
    editor.handleInput(":");
    editor.handleInput("w");
    editor.handleInput("\r");
    expect(saved).toEqual([{ text: "data", path: "/tmp/x.md" }]);
    expect(editor.dirty).toBe(false);
    expect(editor.mode).toBe("normal");
  });

  it("saves via ctrl+s", () => {
    let saves = 0;
    const editor = makeEditor("data", { onSave: () => saves++ });
    editor.handleInput("\x13");
    expect(saves).toBe(1);
  });

  it("refuses :q when the buffer is dirty and force-quits with :q!", () => {
    const exits: Array<{ dirty: boolean }> = [];
    const editor = makeEditor("data", { onQuit: (info) => exits.push(info) });
    editor.handleInput("x");
    editor.handleInput(":");
    editor.handleInput("q");
    editor.handleInput("\r");
    expect(exits).toHaveLength(0);
    expect(editor.status).toContain("未保存");

    editor.handleInput(":");
    editor.handleInput("q");
    editor.handleInput("!");
    editor.handleInput("\r");
    expect(exits).toEqual([{ dirty: true }]);
  });

  it("exposes the command line for the shell to display", () => {
    const editor = makeEditor("data");
    editor.handleInput(":");
    expect(editor.commandLine).toBe("");
    editor.handleInput("w");
    expect(editor.commandLine).toBe("w");
    editor.handleInput("\x1b");
    expect(editor.commandLine).toBeNull();
  });
});
