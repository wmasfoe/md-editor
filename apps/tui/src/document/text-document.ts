/**
 * TextDocument：文档状态机
 *
 * 职责：持有 piece-table 缓冲区与光标位置，提供 grapheme 粒度的编辑/移动原语。
 * 光标列用「grapheme 下标」表示（不是 code unit，也不是显示列），
 * 显示列按需换算，保证 CJK/emoji 下光标永远停在字符边界。
 * 本类不含任何渲染逻辑，也不感知模式（normal/insert 由键位层做钳制）。
 */
import { PieceTable } from "../buffer/piece-table.ts";
import {
  displayColumnAt,
  graphemeCount,
  graphemeIndexAtDisplayColumn,
  graphemeToOffset,
  offsetToGrapheme,
} from "../buffer/graphemes.ts";
import type { EditOp, EditRecorder } from "./operations.ts";

export interface CursorPosition {
  line: number;
  /** grapheme 下标（0 = 行首，graphemeCount(line) = 行尾之后） */
  grapheme: number;
}

export class TextDocument {
  private readonly buffer: PieceTable;
  private cursorLine = 0;
  private cursorGrapheme = 0;
  /** 内容版本号：每次编辑自增，供渲染层做缓存失效 */
  private revisionCounter = 0;
  /** 上下移动时记忆的目标显示列（vim 语义），水平移动或编辑后失效 */
  private goalColumn: number | null = null;
  private recorder: EditRecorder | null = null;

  constructor(text = "") {
    this.buffer = new PieceTable(text);
  }

  setRecorder(recorder: EditRecorder | null): void {
    this.recorder = recorder;
  }

  /** 内容版本号（编辑即自增；纯光标移动不变） */
  get version(): number {
    return this.revisionCounter;
  }

  // ── 文档读取 ──────────────────────────────────────────────

  getText(): string {
    return this.buffer.getText();
  }

  get length(): number {
    return this.buffer.length;
  }

  get lineCount(): number {
    return this.buffer.lineCount;
  }

  lineText(line: number): string {
    return this.buffer.lineText(line);
  }

  // ── 光标 ────────────────────────────────────────────────

  get position(): CursorPosition {
    return { line: this.cursorLine, grapheme: this.cursorGrapheme };
  }

  /** 光标处的绝对偏移（UTF-16 code unit） */
  get offset(): number {
    return this.lineStartOffset(this.cursorLine) + this.graphemeOffsetInLine(this.cursorGrapheme);
  }

  /** 光标处的显示列（终端列，CJK 计 2） */
  get displayColumn(): number {
    return displayColumnAt(this.currentLineText, this.cursorGrapheme);
  }

  get currentLineText(): string {
    return this.buffer.lineText(this.cursorLine);
  }

  /** 本行 grapheme 数量（= 行尾之后的插入位置） */
  get currentLineLength(): number {
    return graphemeCount(this.currentLineText);
  }

  setPosition(line: number, grapheme: number): void {
    this.cursorLine = Math.max(0, Math.min(line, this.buffer.lineCount - 1));
    this.cursorGrapheme = Math.max(0, Math.min(grapheme, this.currentLineLength));
    this.goalColumn = null;
  }

  setOffset(offset: number): void {
    const { line, col } = this.buffer.positionAt(offset);
    this.cursorLine = line;
    this.cursorGrapheme = offsetToGrapheme(this.buffer.lineText(line), col);
    this.goalColumn = null;
  }

  moveLeft(): void {
    this.goalColumn = null;
    if (this.cursorGrapheme > 0) {
      this.cursorGrapheme--;
      return;
    }
    if (this.cursorLine > 0) {
      this.cursorLine--;
      this.cursorGrapheme = this.currentLineLength;
    }
  }

  moveRight(): void {
    this.goalColumn = null;
    if (this.cursorGrapheme < this.currentLineLength) {
      this.cursorGrapheme++;
      return;
    }
    if (this.cursorLine < this.buffer.lineCount - 1) {
      this.cursorLine++;
      this.cursorGrapheme = 0;
    }
  }

  moveUp(): void {
    const goal = this.goalColumn ?? this.displayColumn;
    if (this.cursorLine === 0) {
      this.cursorGrapheme = 0;
      this.goalColumn = goal;
      return;
    }
    this.cursorLine--;
    this.cursorGrapheme = graphemeIndexAtDisplayColumn(this.currentLineText, goal);
    this.goalColumn = goal;
  }

  moveDown(): void {
    const goal = this.goalColumn ?? this.displayColumn;
    if (this.cursorLine >= this.buffer.lineCount - 1) {
      this.cursorGrapheme = this.currentLineLength;
      this.goalColumn = goal;
      return;
    }
    this.cursorLine++;
    this.cursorGrapheme = graphemeIndexAtDisplayColumn(this.currentLineText, goal);
    this.goalColumn = goal;
  }

  moveLineStart(): void {
    this.goalColumn = null;
    this.cursorGrapheme = 0;
  }

  /** 移到行尾之后（insert 模式的合法位置；normal 模式请配合 clampToLastGrapheme） */
  moveLineEnd(): void {
    this.goalColumn = null;
    this.cursorGrapheme = this.currentLineLength;
  }

  moveDocStart(): void {
    this.goalColumn = null;
    this.cursorLine = 0;
    this.cursorGrapheme = 0;
  }

  moveDocEnd(): void {
    this.goalColumn = null;
    this.cursorLine = this.buffer.lineCount - 1;
    this.cursorGrapheme = this.currentLineLength;
  }

  /** normal 模式钳制：光标不能停在最后一个字符之后（空行停在行首） */
  clampToLastGrapheme(): void {
    this.cursorGrapheme = Math.min(this.cursorGrapheme, Math.max(0, this.currentLineLength - 1));
  }

  // ── 编辑 ────────────────────────────────────────────────

  /** 在光标处插入文本，光标随之右移（含换行时会跨行） */
  insertText(text: string): void {
    if (text.length === 0) return;
    const at = this.offset;
    this.buffer.insert(at, text);
    this.recorder?.record({ kind: "insert", offset: at, text });
    this.revisionCounter++;
    this.goalColumn = null;
    this.setOffsetWithoutReset(at + text.length);
  }

  /** 删除光标前一个 grapheme（行首时与上一行合并），返回被删除的文本 */
  deleteBackward(): string {
    if (this.cursorGrapheme > 0) {
      const lineStart = this.lineStartOffset(this.cursorLine);
      const from = lineStart + this.graphemeOffsetInLine(this.cursorGrapheme - 1);
      const to = lineStart + this.graphemeOffsetInLine(this.cursorGrapheme);
      return this.deleteRange(from, to - from);
    }
    if (this.cursorLine > 0) {
      const previousLineStart = this.lineStartOffset(this.cursorLine - 1);
      const previousLineEnd = previousLineStart + this.buffer.lineText(this.cursorLine - 1).length;
      return this.deleteRange(previousLineEnd, 1);
    }
    return "";
  }

  /** 删除光标处一个 grapheme（行尾时吞掉换行），返回被删除的文本 */
  deleteForward(): string {
    if (this.cursorGrapheme < this.currentLineLength) {
      const lineStart = this.lineStartOffset(this.cursorLine);
      const from = lineStart + this.graphemeOffsetInLine(this.cursorGrapheme);
      const to = lineStart + this.graphemeOffsetInLine(this.cursorGrapheme + 1);
      return this.deleteRange(from, to - from);
    }
    if (this.cursorLine < this.buffer.lineCount - 1) {
      const lineEnd = this.lineStartOffset(this.cursorLine) + this.currentLineText.length;
      return this.deleteRange(lineEnd, 1);
    }
    return "";
  }

  /** 应用一组逆操作（undo/redo 回放用），回放期间不记录历史；结束时光标停在改动区起点 */
  applyOps(ops: readonly EditOp[]): void {
    if (ops.length === 0) return;
    const saved = this.recorder;
    this.recorder = null;
    let affectedFrom = Number.POSITIVE_INFINITY;
    try {
      for (const op of ops) {
        affectedFrom = Math.min(affectedFrom, op.offset);
        if (op.kind === "insert") {
          this.buffer.insert(op.offset, op.text);
          this.setOffsetWithoutReset(op.offset + op.text.length);
        } else {
          this.buffer.delete(op.offset, op.text.length);
          this.setOffsetWithoutReset(op.offset);
        }
      }
      this.setOffsetWithoutReset(affectedFrom);
    } finally {
      this.recorder = saved;
    }
    this.revisionCounter++;
    this.goalColumn = null;
  }

  // ── 内部 ────────────────────────────────────────────────

  private deleteRange(from: number, length: number): string {
    if (length <= 0) return "";
    const removed = this.buffer.delete(from, length);
    this.recorder?.record({ kind: "delete", offset: from, text: removed });
    this.revisionCounter++;
    this.goalColumn = null;
    this.setOffsetWithoutReset(from);
    return removed;
  }

  /** setOffset 的内部版本：跨行编辑后重算行列，但不重置 goalColumn（由调用方决定） */
  private setOffsetWithoutReset(offset: number): void {
    const { line, col } = this.buffer.positionAt(offset);
    this.cursorLine = line;
    this.cursorGrapheme = offsetToGrapheme(this.buffer.lineText(line), col);
  }

  private lineStartOffset(line: number): number {
    return this.buffer.offsetAt({ line, col: 0 });
  }

  private graphemeOffsetInLine(grapheme: number): number {
    return graphemeToOffset(this.currentLineText, grapheme);
  }
}

export type { EditOp };
