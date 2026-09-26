import { describe, expect, it } from "vitest";
import { PieceTable } from "../src/buffer/piece-table.ts";

describe("PieceTable", () => {
  it("starts empty and reads back initial content", () => {
    expect(new PieceTable().length).toBe(0);
    expect(new PieceTable("hello").getText()).toBe("hello");
  });

  it("inserts at the beginning, middle and end", () => {
    const b = new PieceTable("hello world");
    b.insert(5, " beautiful");
    expect(b.getText()).toBe("hello beautiful world");
    b.insert(0, ">> ");
    expect(b.getText()).toBe(">> hello beautiful world");
    b.insert(b.length, "!");
    expect(b.getText()).toBe(">> hello beautiful world!");
  });

  it("inserts into an empty buffer", () => {
    const b = new PieceTable();
    b.insert(0, "abc");
    expect(b.getText()).toBe("abc");
    expect(b.length).toBe(3);
  });

  it("deletes across piece boundaries and returns the removed text", () => {
    const b = new PieceTable("a".repeat(100));
    b.insert(50, "XYZ");
    const removed = b.delete(40, 20);
    expect(removed).toBe("a".repeat(10) + "XYZ" + "a".repeat(7));
    expect(b.length).toBe(83);
    expect(b.getText()).toBe("a".repeat(83));
  });

  it("deletes at the very start and very end", () => {
    const b = new PieceTable("abcdef");
    expect(b.delete(0, 2)).toBe("ab");
    expect(b.delete(b.length - 2, 2)).toBe("ef");
    expect(b.getText()).toBe("cd");
  });

  it("maps offset to line/col and back", () => {
    const b = new PieceTable("ab\ncd\nef");
    expect(b.lineCount).toBe(3);
    expect(b.positionAt(0)).toEqual({ line: 0, col: 0 });
    expect(b.positionAt(4)).toEqual({ line: 1, col: 1 });
    expect(b.positionAt(6)).toEqual({ line: 2, col: 0 });
    expect(b.offsetAt({ line: 0, col: 0 })).toBe(0);
    expect(b.offsetAt({ line: 1, col: 1 })).toBe(4);
    expect(b.offsetAt({ line: 2, col: 0 })).toBe(6);
  });

  it("clamps offsetAt to the end of the requested line", () => {
    const b = new PieceTable("ab\ncd");
    // 第 0 行最多停到换行符位置（col=2），不能越到第 1 行
    expect(b.offsetAt({ line: 0, col: 99 })).toBe(2);
    expect(b.offsetAt({ line: 1, col: 99 })).toBe(5);
  });

  it("keeps line index correct after inserts with newlines", () => {
    const b = new PieceTable("ab\ncd");
    b.insert(2, "\nX\n");
    expect(b.getText()).toBe("ab\nX\n\ncd");
    expect(b.lineCount).toBe(4);
    expect(b.positionAt(3)).toEqual({ line: 1, col: 0 });
    expect(b.positionAt(5)).toEqual({ line: 2, col: 0 });
  });

  it("keeps line index correct after deletes spanning newlines", () => {
    const b = new PieceTable("a\nb\nc\nd");
    b.delete(1, 3); // 删掉 "\nb\n"
    expect(b.getText()).toBe("ac\nd");
    expect(b.lineCount).toBe(2);
    // offset 2 是换行符本身，属于第 0 行行尾；第 1 行从 offset 3 开始
    expect(b.positionAt(2)).toEqual({ line: 0, col: 2 });
    expect(b.positionAt(3)).toEqual({ line: 1, col: 0 });
  });

  it("handles 1MB text with 5000 random inserts quickly", () => {
    const lines = 20000;
    const big = Array.from({ length: lines }, (_, i) => `line ${i} content`).join("\n");
    const b = new PieceTable(big);
    const rng = mulberry32(42);
    const started = performance.now();
    for (let i = 0; i < 5000; i++) {
      const at = Math.floor(rng() * b.length);
      b.insert(at, "x");
    }
    const elapsed = performance.now() - started;
    expect(b.length).toBe(big.length + 5000);
    expect(elapsed).toBeLessThan(1000);
  });
});

/** 确定性伪随机，保证性能用例可复现 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
