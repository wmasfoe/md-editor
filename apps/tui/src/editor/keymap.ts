/**
 * 模态键位层
 *
 * 三模态：normal（移动/操作）、insert（输入）、command（`:w` 等命令行）。
 * 输入统一先经 pi-tui 的 parseKey 归一化为 keyId（兼容 Kitty 协议与旧转义序列），
 * 归一化失败的可见输入按「文本」处理（IME 提交的中文就是这样到达的）。
 * 多键序列（gg / dd / yy）用一个 pending 缓冲实现，按 Esc 或无关键清空。
 */
import { parseKey } from "@earendil-works/pi-tui";

export type EditorMode = "normal" | "insert" | "command";

export type EditorMotion =
  "left" | "right" | "up" | "down" | "line-start" | "line-end" | "doc-start" | "doc-end";

export type InsertPlacement =
  "before" | "after" | "line-start" | "line-end" | "new-line-below" | "new-line-above";

export type EditorCommand =
  | { type: "move"; motion: EditorMotion }
  | { type: "enter-insert"; placement: InsertPlacement }
  | { type: "enter-normal" }
  | { type: "insert-text"; text: string }
  | { type: "delete-backward" }
  | { type: "delete-forward" }
  | { type: "delete-line" }
  | { type: "yank-line" }
  | { type: "paste" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "save" }
  | { type: "quit" }
  | { type: "enter-command" }
  | { type: "command-append"; text: string }
  | { type: "command-backspace" }
  | { type: "command-run" }
  | { type: "command-cancel" }
  | { type: "noop" };

const NOOP: EditorCommand = { type: "noop" };

/** 括号粘贴：\x1b[200~ ... \x1b[201~，内部内容整体作为文本插入 */
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export class EditorKeymap {
  private pending = "";

  /** 状态栏展示用：已按下但未完成的多键前缀 */
  get pendingPrefix(): string {
    return this.pending;
  }

  reset(): void {
    this.pending = "";
  }

  feed(mode: EditorMode, data: string): EditorCommand {
    if (mode === "insert") return this.feedInsert(data);
    if (mode === "command") return this.feedCommand(data);
    return this.feedNormal(data);
  }

  // ── normal ──────────────────────────────────────────────

  private feedNormal(data: string): EditorCommand {
    const key = parseKey(data);

    if (this.pending === "g") {
      this.pending = "";
      if (key === "g") return { type: "move", motion: "doc-start" };
      return NOOP;
    }
    if (this.pending === "d") {
      this.pending = "";
      if (key === "d") return { type: "delete-line" };
      return NOOP;
    }
    if (this.pending === "y") {
      this.pending = "";
      if (key === "y") return { type: "yank-line" };
      return NOOP;
    }

    if (key === undefined) {
      // 非按键序列的可见文本：normal 模式忽略（粘贴走 ctrl+v / p 语义，不做隐式插入）
      return NOOP;
    }

    switch (key) {
      case "h":
      case "left":
        return { type: "move", motion: "left" };
      case "j":
      case "down":
        return { type: "move", motion: "down" };
      case "k":
      case "up":
        return { type: "move", motion: "up" };
      case "l":
      case "right":
        return { type: "move", motion: "right" };
      case "0":
      case "home":
        return { type: "move", motion: "line-start" };
      case "$":
      case "end":
        return { type: "move", motion: "line-end" };
      case "G":
        return { type: "move", motion: "doc-end" };
      case "g":
        this.pending = "g";
        return NOOP;
      case "d":
        this.pending = "d";
        return NOOP;
      case "y":
        this.pending = "y";
        return NOOP;
      case "i":
        return { type: "enter-insert", placement: "before" };
      case "a":
        return { type: "enter-insert", placement: "after" };
      case "I":
        return { type: "enter-insert", placement: "line-start" };
      case "A":
        return { type: "enter-insert", placement: "line-end" };
      case "o":
        return { type: "enter-insert", placement: "new-line-below" };
      case "O":
        return { type: "enter-insert", placement: "new-line-above" };
      case "x":
        return { type: "delete-forward" };
      case "p":
        return { type: "paste" };
      case "u":
        return { type: "undo" };
      case "ctrl+r":
        return { type: "redo" };
      case "ctrl+s":
        return { type: "save" };
      case ":":
        this.pending = "";
        return { type: "enter-command" };
      case "escape":
        this.pending = "";
        return NOOP;
      default:
        return NOOP;
    }
  }

  // ── insert ──────────────────────────────────────────────

  private feedInsert(data: string): EditorCommand {
    if (data.includes(PASTE_START)) {
      const text = extractPastedText(data);
      return text.length > 0 ? { type: "insert-text", text } : NOOP;
    }

    const key = parseKey(data);
    switch (key) {
      case "escape":
        return { type: "enter-normal" };
      case "enter":
        return { type: "insert-text", text: "\n" };
      case "tab":
        return { type: "insert-text", text: "  " };
      case "backspace":
        return { type: "delete-backward" };
      case "delete":
        return { type: "delete-forward" };
      case "left":
        return { type: "move", motion: "left" };
      case "right":
        return { type: "move", motion: "right" };
      case "up":
        return { type: "move", motion: "up" };
      case "down":
        return { type: "move", motion: "down" };
      case "home":
        return { type: "move", motion: "line-start" };
      case "end":
        return { type: "move", motion: "line-end" };
      case "ctrl+s":
        return { type: "save" };
      default:
        break;
    }
    if (isInsertableText(data)) return { type: "insert-text", text: data };
    return NOOP;
  }

  // ── command ─────────────────────────────────────────────

  private feedCommand(data: string): EditorCommand {
    const key = parseKey(data);
    switch (key) {
      case "escape":
        return { type: "command-cancel" };
      case "enter":
        return { type: "command-run" };
      case "backspace":
        return { type: "command-backspace" };
      default:
        break;
    }
    if (isInsertableText(data)) return { type: "command-append", text: data };
    return NOOP;
  }
}

/** 从括号粘贴序列中取出正文（完整或分片到达都尽量取） */
export function extractPastedText(data: string): string {
  let text = data;
  const start = text.indexOf(PASTE_START);
  if (start >= 0) text = text.slice(start + PASTE_START.length);
  const end = text.indexOf(PASTE_END);
  if (end >= 0) text = text.slice(0, end);
  return text;
}

/** 可见文本判定：非空、不含 ESC/C0 控制符 */
export function isInsertableText(data: string): boolean {
  if (data.length === 0) return false;
  for (const char of data) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
