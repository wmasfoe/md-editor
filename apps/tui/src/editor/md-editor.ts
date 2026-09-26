/**
 * MdEditor：vim 式 Markdown 编辑器组件
 *
 * 硬规则（可嵌入性的契约）：本组件**不感知终端尺寸、不直接读写 stdout**。
 * - render(width) 只依赖传入宽度，返回整篇文档的渲染行（1 渲染行 = 1 源码行）；
 * - 视口滚动由外部壳子决定：全屏壳子把它塞进 ScrollView（光标驱动滚动），
 *   嵌入壳子把它塞进任意 Container 或固定高度区域；
 * - 聚焦时在光标处输出 CURSOR_MARKER，由 pi-tui 把硬件光标移过去，
 *   这是终端 IME（fcitx/ibus/系统输入法）候选窗能对准光标的前提。
 */
import {
  CURSOR_MARKER,
  sliceByColumn,
  truncateToWidth,
  type Component,
  type Focusable,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { DocumentHistory } from "../document/history.ts";
import { TextDocument } from "../document/text-document.ts";
import { EditorKeymap, type EditorCommand, type EditorMode } from "./keymap.ts";
import { MdDocumentView } from "../render/md-view.ts";
import { defaultTheme, type TerminalTheme } from "../render/theme.ts";

export interface MdEditorOptions {
  initialText?: string;
  filePath?: string | null;
  theme?: TerminalTheme;
  /** 保存回调：壳子负责真正落盘（组件不做 IO） */
  onSave?: (text: string, filePath: string | null) => void;
  /** 退出回调：壳子负责收尾（停止 TUI、退出进程） */
  onQuit?: (options: { dirty: boolean }) => void;
  /** 状态栏消息回调（保存成功、命令未实现等提示） */
  onStatusMessage?: (message: string) => void;
  /** 内容变化回调（外部可用于 dirty 标记/自动保存） */
  onChange?: () => void;
}

export class MdEditor implements Component, Focusable {
  readonly doc: TextDocument;
  readonly history: DocumentHistory;
  focused = false;

  private readonly view: MdDocumentView;
  private readonly keymap = new EditorKeymap();
  private readonly options: MdEditorOptions;
  private currentMode: EditorMode = "normal";
  private commandBuffer = "";
  private yankBuffer = "";
  private dirtyFlag = false;
  private path: string | null;
  private statusMessage = "";

  constructor(options: MdEditorOptions = {}) {
    this.options = options;
    this.doc = new TextDocument(options.initialText ?? "");
    this.history = new DocumentHistory(this.doc);
    this.doc.setRecorder(this.history);
    this.view = new MdDocumentView(this.doc, options.theme ?? defaultTheme);
    this.path = options.filePath ?? null;
    // 新文档从 insert 模式起步，打开已有文件的文档从 normal 起步（vim 习惯）
    this.currentMode = (options.initialText?.length ?? 0) > 0 ? "normal" : "insert";
  }

  // ── 状态（供状态栏/壳子读取） ──────────────────────────────

  get mode(): EditorMode {
    return this.currentMode;
  }

  get filePath(): string | null {
    return this.path;
  }

  setFilePath(path: string | null): void {
    this.path = path;
  }

  get dirty(): boolean {
    return this.dirtyFlag;
  }

  markSaved(): void {
    this.dirtyFlag = false;
  }

  get status(): string {
    return this.statusMessage;
  }

  setStatus(message: string): void {
    this.statusMessage = message;
    this.options.onStatusMessage?.(message);
  }

  get pendingPrefix(): string {
    return this.keymap.pendingPrefix;
  }

  get commandLine(): string | null {
    return this.currentMode === "command" ? this.commandBuffer : null;
  }

  getCursorInfo(): { line: number; column: number; displayColumn: number } {
    return {
      line: this.doc.position.line + 1,
      column: this.doc.position.grapheme + 1,
      displayColumn: this.doc.displayColumn,
    };
  }

  // ── Component ───────────────────────────────────────────

  invalidate(): void {
    this.view.invalidate();
  }

  /** 渲染整篇文档；每行按 width 截断（v1 不做横向滚动） */
  render(width: number): string[] {
    const cursorLine = this.doc.position.line;
    const gutter = this.lineGutterWidth();
    const lines: string[] = [];

    for (let line = 0; line < this.doc.lineCount; line++) {
      const isCursorLine = line === cursorLine && this.focused;
      const styled = this.view.renderLine(line, { active: line === cursorLine });
      let text = styled;
      if (isCursorLine) {
        text = this.insertCursorMarker(styled);
      }
      lines.push(this.withGutter(line, text, gutter, width));
    }
    return lines;
  }

  handleInput(data: string): void {
    const command = this.keymap.feed(this.currentMode, data);
    this.applyCommand(command);
  }

  /** 鼠标：滚轮交给壳子的 ScrollView；点击定位 v1 不做（隐藏标记会让列映射偏移） */
  handleMouse(_event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return undefined;
  }

  // ── 命令应用 ────────────────────────────────────────────

  private applyCommand(command: EditorCommand): void {
    switch (command.type) {
      case "move":
        this.applyMotion(command.motion);
        break;
      case "enter-insert":
        this.enterInsert(command.placement);
        break;
      case "enter-normal":
        this.currentMode = "normal";
        this.doc.clampToLastGrapheme();
        this.history.flush();
        this.notifyChange();
        break;
      case "insert-text":
        this.doc.insertText(command.text);
        this.dirtyFlag = true;
        if (command.text.includes("\n")) this.history.flush();
        this.notifyChange();
        break;
      case "delete-backward":
        this.doc.deleteBackward();
        this.dirtyFlag = true;
        this.notifyChange();
        break;
      case "delete-forward":
        this.doc.deleteForward();
        this.dirtyFlag = true;
        this.notifyChange();
        break;
      case "delete-line":
        this.yankBuffer = this.doc.lineText(this.doc.position.line);
        this.doc.deleteLines(this.doc.position.line, 1);
        this.dirtyFlag = true;
        this.history.flush();
        this.notifyChange();
        break;
      case "yank-line":
        this.yankBuffer = this.doc.lineText(this.doc.position.line);
        this.setStatus(`已复制 1 行`);
        break;
      case "paste":
        if (this.yankBuffer.length === 0) {
          this.setStatus("复制缓冲区为空");
          break;
        }
        this.doc.moveLineEnd();
        this.doc.insertText(`\n${this.yankBuffer}`);
        this.dirtyFlag = true;
        this.history.flush();
        this.notifyChange();
        break;
      case "undo":
        if (this.history.undo()) {
          this.dirtyFlag = true;
          this.doc.clampToLastGrapheme();
          this.notifyChange();
        }
        break;
      case "redo":
        if (this.history.redo()) {
          this.dirtyFlag = true;
          this.doc.clampToLastGrapheme();
          this.notifyChange();
        }
        break;
      case "save":
        this.save();
        break;
      case "quit":
        this.quit();
        break;
      case "enter-command":
        this.currentMode = "command";
        this.commandBuffer = "";
        break;
      case "command-append":
        this.commandBuffer += command.text;
        break;
      case "command-backspace":
        this.commandBuffer = this.commandBuffer.slice(0, -1);
        break;
      case "command-run":
        this.runCommandLine(this.commandBuffer);
        break;
      case "command-cancel":
        this.currentMode = "normal";
        this.commandBuffer = "";
        break;
      default:
        break;
    }
  }

  private applyMotion(motion: string): void {
    switch (motion) {
      case "left":
        this.doc.moveLeft();
        break;
      case "right":
        this.doc.moveRight();
        break;
      case "up":
        this.doc.moveUp();
        break;
      case "down":
        this.doc.moveDown();
        break;
      case "line-start":
        this.doc.moveLineStart();
        break;
      case "line-end":
        this.doc.moveLineEnd();
        break;
      case "doc-start":
        this.doc.moveDocStart();
        break;
      case "doc-end":
        this.doc.moveDocEnd();
        break;
      default:
        break;
    }
    if (this.currentMode === "normal") this.doc.clampToLastGrapheme();
    this.history.flush();
    this.notifyChange();
  }

  private enterInsert(placement: string): void {
    switch (placement) {
      case "after":
        this.doc.moveRight();
        break;
      case "line-start":
        this.doc.moveLineStart();
        break;
      case "line-end":
        this.doc.moveLineEnd();
        break;
      case "new-line-below":
        this.doc.moveLineEnd();
        this.doc.insertText("\n");
        this.dirtyFlag = true;
        break;
      case "new-line-above":
        this.doc.moveLineStart();
        this.doc.insertText("\n");
        this.dirtyFlag = true;
        break;
      default:
        break;
    }
    this.currentMode = "insert";
    this.history.flush();
    this.notifyChange();
  }

  private runCommandLine(input: string): void {
    this.currentMode = "normal";
    this.commandBuffer = "";
    const trimmed = input.trim();
    if (trimmed === "w") {
      this.save();
      return;
    }
    if (trimmed === "q") {
      this.quit();
      return;
    }
    if (trimmed === "wq" || trimmed === "x") {
      this.save();
      this.quit();
      return;
    }
    if (trimmed === "q!") {
      this.forceQuit();
      return;
    }
    if (trimmed.startsWith("e ")) {
      const target = trimmed.slice(2).trim();
      if (target.length > 0) {
        this.setStatus(`:e 需要壳子支持，当前文件 ${this.path ?? "未命名"}`);
        this.options.onStatusMessage?.(this.statusMessage);
      }
      return;
    }
    if (trimmed.length === 0) return;
    this.setStatus(`未实现命令: ${trimmed}`);
    this.options.onStatusMessage?.(this.statusMessage);
  }

  private save(): void {
    this.history.flush();
    this.options.onSave?.(this.doc.getText(), this.path);
    this.dirtyFlag = false;
    this.setStatus("已保存");
  }

  private quit(): void {
    if (this.dirtyFlag) {
      this.setStatus("有未保存修改，:q! 强制退出 或 :w 保存");
      return;
    }
    this.options.onQuit?.({ dirty: false });
  }

  private forceQuit(): void {
    this.options.onQuit?.({ dirty: this.dirtyFlag });
  }

  private notifyChange(): void {
    this.options.onChange?.();
  }

  // ── 渲染辅助 ────────────────────────────────────────────

  /** 在光标显示列处插入 CURSOR_MARKER，让硬件光标（IME 候选窗）落在正确位置 */
  private insertCursorMarker(styledLine: string): string {
    const displayColumn = this.doc.displayColumn;
    if (displayColumn === 0) return CURSOR_MARKER + styledLine;
    const head = sliceByColumn(styledLine, 0, displayColumn);
    const tail = sliceByColumn(styledLine, displayColumn, 100000);
    return `${head}${CURSOR_MARKER}${tail}`;
  }

  private lineGutterWidth(): number {
    // 行号宽度随总行数增长，最少 3 列
    return Math.max(3, String(this.doc.lineCount).length);
  }

  private withGutter(line: number, text: string, gutter: number, width: number): string {
    const lineNumber = String(line + 1).padStart(gutter - 1, " ");
    const gutterText = `${lineNumber} `;
    const available = Math.max(0, width - gutter);
    return gutterText + truncateToWidth(text, available);
  }
}
