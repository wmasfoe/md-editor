/**
 * 状态栏：一行显示模式 / 文件名 / 脏标记 / 光标位置 / 文档百分比。
 * 命令行模式（:w 等）时该行临时变成命令行。
 */
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { MdEditor } from "../editor/md-editor.ts";
import { defaultTheme, type TerminalTheme } from "../render/theme.ts";

const MODE_LABEL: Record<string, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  command: "COMMAND",
};

export class StatusBar implements Component {
  constructor(
    private readonly editor: MdEditor,
    private readonly theme: TerminalTheme = defaultTheme,
  ) {}

  invalidate(): void {
    // 无缓存
  }

  render(width: number): string[] {
    const editor = this.editor;
    const commandLine = editor.commandLine;
    if (commandLine !== null) {
      return [truncateToWidth(this.theme.marker(`:${commandLine}▏`), width)];
    }

    const message = editor.status;
    if (message.length > 0) {
      return [truncateToWidth(this.theme.dim(message), width)];
    }

    const { line, column } = editor.getCursorInfo();
    const total = editor.doc.lineCount;
    const percent = total <= 1 ? 100 : Math.round(((line - 1) / (total - 1)) * 100);
    const left = ` ${MODE_LABEL[editor.mode] ?? editor.mode}${editor.pendingPrefix}`;
    const dirtyMark = editor.dirty ? " [+]" : "";
    const file = (editor.filePath ?? "[未命名]") + dirtyMark;
    const right = `${file} │ ${line}:${column} │ ${percent}%`;

    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 1);
    const line1 = `${left}${" ".repeat(gap)}${right} `;
    return [truncateToWidth(line1, width)];
  }
}
