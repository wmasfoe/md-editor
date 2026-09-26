import { describe, expect, it } from "vitest";
import { EditorKeymap, extractPastedText } from "../src/editor/keymap.ts";

describe("EditorKeymap / normal mode", () => {
  it("maps hjkl and arrow keys to motions", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "h")).toEqual({ type: "move", motion: "left" });
    expect(km.feed("normal", "j")).toEqual({ type: "move", motion: "down" });
    expect(km.feed("normal", "k")).toEqual({ type: "move", motion: "up" });
    expect(km.feed("normal", "l")).toEqual({ type: "move", motion: "right" });
    expect(km.feed("normal", "\x1b[B")).toEqual({ type: "move", motion: "down" });
  });

  it("maps 0/$/G and the gg sequence", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "0")).toEqual({ type: "move", motion: "line-start" });
    expect(km.feed("normal", "$")).toEqual({ type: "move", motion: "line-end" });
    expect(km.feed("normal", "G")).toEqual({ type: "move", motion: "doc-end" });
    expect(km.feed("normal", "g")).toEqual({ type: "noop" });
    expect(km.pendingPrefix).toBe("g");
    expect(km.feed("normal", "g")).toEqual({ type: "move", motion: "doc-start" });
    expect(km.pendingPrefix).toBe("");
  });

  it("drops an incomplete multi-key sequence on an unrelated key", () => {
    const km = new EditorKeymap();
    km.feed("normal", "g");
    expect(km.feed("normal", "x")).toEqual({ type: "noop" });
    expect(km.pendingPrefix).toBe("");
  });

  it("maps dd/yy/p/x", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "d")).toEqual({ type: "noop" });
    expect(km.feed("normal", "d")).toEqual({ type: "delete-line" });
    expect(km.feed("normal", "y")).toEqual({ type: "noop" });
    expect(km.feed("normal", "y")).toEqual({ type: "yank-line" });
    expect(km.feed("normal", "p")).toEqual({ type: "paste" });
    expect(km.feed("normal", "x")).toEqual({ type: "delete-forward" });
  });

  it("maps insert-entry keys", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "i")).toEqual({ type: "enter-insert", placement: "before" });
    expect(km.feed("normal", "a")).toEqual({ type: "enter-insert", placement: "after" });
    expect(km.feed("normal", "I")).toEqual({ type: "enter-insert", placement: "line-start" });
    expect(km.feed("normal", "A")).toEqual({ type: "enter-insert", placement: "line-end" });
    expect(km.feed("normal", "o")).toEqual({ type: "enter-insert", placement: "new-line-below" });
    expect(km.feed("normal", "O")).toEqual({ type: "enter-insert", placement: "new-line-above" });
  });

  it("maps undo/redo/save/command", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "u")).toEqual({ type: "undo" });
    expect(km.feed("normal", "\x12")).toEqual({ type: "redo" });
    expect(km.feed("normal", "\x13")).toEqual({ type: "save" });
    expect(km.feed("normal", ":")).toEqual({ type: "enter-command" });
  });

  it("ignores plain text in normal mode", () => {
    const km = new EditorKeymap();
    expect(km.feed("normal", "中文")).toEqual({ type: "noop" });
  });
});

describe("EditorKeymap / insert mode", () => {
  it("inserts printable text including CJK", () => {
    const km = new EditorKeymap();
    expect(km.feed("insert", "a")).toEqual({ type: "insert-text", text: "a" });
    expect(km.feed("insert", "中文")).toEqual({ type: "insert-text", text: "中文" });
  });

  it("handles enter, tab, backspace, delete and escape", () => {
    const km = new EditorKeymap();
    expect(km.feed("insert", "\r")).toEqual({ type: "insert-text", text: "\n" });
    expect(km.feed("insert", "\t")).toEqual({ type: "insert-text", text: "  " });
    expect(km.feed("insert", "\x7f")).toEqual({ type: "delete-backward" });
    expect(km.feed("insert", "\x1b[3~")).toEqual({ type: "delete-forward" });
    expect(km.feed("insert", "\x1b")).toEqual({ type: "enter-normal" });
  });

  it("extracts bracketed paste payload as one text insert", () => {
    const km = new EditorKeymap();
    expect(km.feed("insert", "\x1b[200~hello\nworld\x1b[201~")).toEqual({
      type: "insert-text",
      text: "hello\nworld",
    });
    expect(extractPastedText("\x1b[200~abc")).toBe("abc");
  });
});

describe("EditorKeymap / command mode", () => {
  it("appends text, runs on enter and cancels on escape", () => {
    const km = new EditorKeymap();
    expect(km.feed("command", "w")).toEqual({ type: "command-append", text: "w" });
    expect(km.feed("command", "\x7f")).toEqual({ type: "command-backspace" });
    expect(km.feed("command", "\r")).toEqual({ type: "command-run" });
    expect(km.feed("command", "\x1b")).toEqual({ type: "command-cancel" });
  });
});
