/**
 * Piece table 文本缓冲区
 *
 * 设计：只读的 `original` 串 + 只追加的 `add` 串，文档由有序 piece 列表引用两段缓冲区构成。
 * 插入/删除只改动 piece 列表，不复制大字符串；行首偏移表（lineStarts）随编辑增量维护，
 * 供渲染层与光标做 offset ↔ (line, col) 换算。
 *
 * 坐标语义：所有 offset/col 均为 UTF-16 code unit 下标（与 JS 字符串一致）。
 * grapheme（组合字/emoji）与显示列宽换算由 cursor 层负责，不在本层处理。
 */

interface Piece {
  /** "original" = 构造时的初始内容；"add" = 编辑追加缓冲区 */
  buffer: "original" | "add";
  /** 在该缓冲区中的起始下标 */
  start: number;
  /** 长度（UTF-16 code units） */
  length: number;
}

export interface LineCol {
  line: number;
  col: number;
}

export class PieceTable {
  private readonly original: string;
  private add = "";
  private pieces: Piece[] = [];
  private totalLength = 0;
  /** 行首偏移（升序，恒以 0 开头） */
  private lineStarts: number[] = [0];

  constructor(initial = "") {
    this.original = initial;
    if (initial.length > 0) {
      this.pieces.push({ buffer: "original", start: 0, length: initial.length });
      this.totalLength = initial.length;
      this.rebuildLineIndex();
    }
  }

  get length(): number {
    return this.totalLength;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** 导出全文（保存文件 / 交给解析器用） */
  getText(): string {
    if (this.pieces.length === 0) return "";
    const parts: string[] = [];
    for (const piece of this.pieces) {
      const source = piece.buffer === "original" ? this.original : this.add;
      parts.push(source.slice(piece.start, piece.start + piece.length));
    }
    return parts.join("");
  }

  toString(): string {
    return this.getText();
  }

  /** 在 offset 处插入文本（插到该位置原字符之前） */
  insert(at: number, text: string): void {
    if (text.length === 0) return;
    if (at < 0 || at > this.totalLength) {
      throw new RangeError(`insert offset out of range: ${at}`);
    }

    const addStart = this.add.length;
    this.add += text;
    const piece: Piece = { buffer: "add", start: addStart, length: text.length };

    const index = this.findPieceIndex(at);
    if (index >= this.pieces.length) {
      this.pieces.push(piece);
    } else {
      const target = this.pieces[index];
      const offsetInPiece = at - this.pieceStart(index);
      if (offsetInPiece === 0) {
        this.pieces.splice(index, 0, piece);
      } else {
        const left: Piece = { ...target, length: offsetInPiece };
        const right: Piece = {
          ...target,
          start: target.start + offsetInPiece,
          length: target.length - offsetInPiece,
        };
        this.pieces.splice(index, 1, left, piece, right);
      }
    }

    this.totalLength += text.length;
    this.applyInsertToLineIndex(at, text);
  }

  /** 删除 [at, at+len)，返回被删除的文本（undo 需要） */
  delete(at: number, len: number): string {
    if (len <= 0) return "";
    if (at < 0 || at + len > this.totalLength) {
      throw new RangeError(`delete range out of bounds: ${at}+${len} > ${this.totalLength}`);
    }

    // 在 at 与 at+len 处切开 piece 边界，随后移除区间内的整片
    const startIndex = this.splitAt(at);
    const endIndex = this.splitAt(at + len, startIndex);
    const removed = this.pieces
      .slice(startIndex, endIndex)
      .map((piece) =>
        (piece.buffer === "original" ? this.original : this.add).slice(
          piece.start,
          piece.start + piece.length,
        ),
      )
      .join("");
    this.pieces.splice(startIndex, endIndex - startIndex);

    this.totalLength -= len;
    this.applyDeleteToLineIndex(at, len);
    return removed;
  }

  /** offset → (line, col) */
  positionAt(offset: number): LineCol {
    const clamped = Math.max(0, Math.min(offset, this.totalLength));
    const line = this.findLineIndex(clamped);
    return { line, col: clamped - this.lineStarts[line] };
  }

  /** (line, col) → offset；col 会被夹到该行最大可停位置（行尾换行符处 / 文末） */
  offsetAt(pos: LineCol): number {
    const line = Math.max(0, Math.min(pos.line, this.lineStarts.length - 1));
    const start = this.lineStarts[line];
    const nextStart = this.lineStarts[line + 1];
    // 非末行：最大停在换行符本身；末行：最大停在文档末尾
    const maxOffset = nextStart === undefined ? this.totalLength : nextStart - 1;
    return Math.min(start + Math.max(0, pos.col), maxOffset);
  }

  /** 返回指定行的文本（不含行尾换行符；末行若无结尾换行则原样返回） */
  lineText(line: number): string {
    if (line < 0 || line >= this.lineStarts.length) return "";
    const start = this.lineStarts[line];
    const nextStart = this.lineStarts[line + 1];
    const end = nextStart === undefined ? this.totalLength : nextStart - 1;
    return this.sliceRange(start, Math.max(start, end));
  }

  /** 复制一段区间文本（供渲染层切片用） */
  sliceRange(from: number, to: number): string {
    const clampedFrom = Math.max(0, Math.min(from, this.totalLength));
    const clampedTo = Math.max(clampedFrom, Math.min(to, this.totalLength));
    if (clampedTo === clampedFrom) return "";
    const parts: string[] = [];
    let cursor = 0;
    for (const piece of this.pieces) {
      const pieceEnd = cursor + piece.length;
      if (pieceEnd > clampedFrom && cursor < clampedTo) {
        const fromInPiece = Math.max(0, clampedFrom - cursor);
        const toInPiece = Math.min(piece.length, clampedTo - cursor);
        const source = piece.buffer === "original" ? this.original : this.add;
        parts.push(source.slice(piece.start + fromInPiece, piece.start + toInPiece));
      }
      cursor = pieceEnd;
      if (cursor >= clampedTo) break;
    }
    return parts.join("");
  }

  // ── 内部实现 ────────────────────────────────────────────────

  /** 找到包含 offset 的 piece 下标；offset === 总长度时返回 pieces.length */
  private findPieceIndex(offset: number): number {
    if (offset >= this.totalLength) return this.pieces.length;
    let cursor = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const next = cursor + this.pieces[i].length;
      if (offset < next) return i;
      cursor = next;
    }
    return this.pieces.length;
  }

  /** 第 index 个 piece 的全局起始偏移 */
  private pieceStart(index: number): number {
    let cursor = 0;
    for (let i = 0; i < index; i++) cursor += this.pieces[i].length;
    return cursor;
  }

  /** 确保 offset 处存在 piece 边界，返回其右侧 piece 下标 */
  private splitAt(offset: number, fromIndex = 0): number {
    if (offset >= this.totalLength) return this.pieces.length;
    if (offset <= 0) {
      if (this.pieces.length === 0) return 0;
      const first = this.pieces[0];
      if (first.length === 0) return 0;
      return 0;
    }
    // 从 fromIndex 起扫描（删除流程里第二次 split 只需在其右侧找）
    let cursor = this.pieceStart(fromIndex);
    for (let i = fromIndex; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      const next = cursor + piece.length;
      if (offset === cursor) return i;
      if (offset < next) {
        const offsetInPiece = offset - cursor;
        const left: Piece = { ...piece, length: offsetInPiece };
        const right: Piece = {
          ...piece,
          start: piece.start + offsetInPiece,
          length: piece.length - offsetInPiece,
        };
        this.pieces.splice(i, 1, left, right);
        return i + 1;
      }
      cursor = next;
    }
    return this.pieces.length;
  }

  /** 从 piece 列表重建行首索引（构造 / 兜底用） */
  private rebuildLineIndex(): void {
    const text = this.pieces.length === 0 ? "" : this.getText();
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  /** 插入后更新行首索引：> at 的旧行首后移，新文本里的换行成为新行首（== at 的旧行首保留，其前驱字符未变） */
  private applyInsertToLineIndex(at: number, text: string): void {
    const boundary = this.lowerBound(this.lineStarts, at, false);
    const shift = text.length;
    for (let i = boundary; i < this.lineStarts.length; i++) {
      this.lineStarts[i] += shift;
    }
    const fresh: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) fresh.push(at + i + 1);
    }
    if (fresh.length > 0) {
      this.lineStarts.splice(boundary, 0, ...fresh);
    }
  }

  /** 删除后更新行首索引：[at+1, at+len] 区间的旧行首全部失效，其余 > at+len 的前移 */
  private applyDeleteToLineIndex(at: number, len: number): void {
    const end = at + len;
    const from = this.lowerBound(this.lineStarts, at, false);
    const to = this.lowerBound(this.lineStarts, end, false);
    if (to > from) this.lineStarts.splice(from, to - from);
    for (let i = from; i < this.lineStarts.length; i++) {
      this.lineStarts[i] -= len;
    }
  }

  /** 二分查找首个 >= 目标值的下标（inclusive 为 true 时用 >=，否则用 >） */
  private lowerBound(arr: number[], target: number, inclusive: boolean): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const value = arr[mid];
      if (value < target || (!inclusive && value === target)) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** 二分查找 offset 所在行号 */
  private findLineIndex(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}
