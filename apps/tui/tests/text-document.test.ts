import { describe, expect, it } from "vitest";
import { TextDocument } from "../src/document/text-document.ts";
import type { EditOp, EditRecorder } from "../src/document/operations.ts";

class RecordingRecorder implements EditRecorder {
  ops: EditOp[] = [];
  record(op: EditOp): void {
    this.ops.push(op);
  }
}

describe("TextDocument", () => {
  it("starts with cursor at the document start", () => {
    const doc = new TextDocument("hello\nworld");
    expect(doc.position).toEqual({ line: 0, grapheme: 0 });
    expect(doc.offset).toBe(0);
    expect(doc.lineCount).toBe(2);
  });

  it("inserts text at the cursor and advances it", () => {
    const doc = new TextDocument("");
    doc.insertText("hello");
    expect(doc.getText()).toBe("hello");
    expect(doc.position).toEqual({ line: 0, grapheme: 5 });
    doc.insertText("!");
    expect(doc.getText()).toBe("hello!");
    expect(doc.offset).toBe(6);
  });

  it("counts CJK and emoji as single cursor steps", () => {
    const doc = new TextDocument("");
    doc.insertText("中文👍");
    expect(doc.position.grapheme).toBe(3);
    doc.moveLeft();
    expect(doc.offset).toBe(2); // 光标移到 👍 之前
    doc.moveLeft();
    expect(doc.offset).toBe(1);
    doc.moveRight();
    expect(doc.offset).toBe(2);
  });

  it("reports CJK display columns", () => {
    const doc = new TextDocument("中a");
    expect(doc.displayColumn).toBe(0);
    doc.moveRight();
    expect(doc.displayColumn).toBe(2); // 中 占 2 列
    doc.moveRight();
    expect(doc.displayColumn).toBe(3);
  });

  it("splits a line when inserting a newline", () => {
    const doc = new TextDocument("helloworld");
    doc.setPosition(0, 5);
    doc.insertText("\n");
    expect(doc.getText()).toBe("hello\nworld");
    expect(doc.position).toEqual({ line: 1, grapheme: 0 });
  });

  it("joins lines when deleting backward at line start", () => {
    const doc = new TextDocument("hello\nworld");
    doc.setPosition(1, 0);
    expect(doc.deleteBackward()).toBe("\n");
    expect(doc.getText()).toBe("helloworld");
    expect(doc.position).toEqual({ line: 0, grapheme: 5 });
  });

  it("deletes one grapheme at a time (emoji safe)", () => {
    const doc = new TextDocument("a👍b");
    doc.setPosition(0, 3);
    doc.deleteBackward();
    expect(doc.getText()).toBe("a👍");
    doc.deleteBackward();
    expect(doc.getText()).toBe("a");
  });

  it("joins lines when deleting forward at line end", () => {
    const doc = new TextDocument("hello\nworld");
    doc.setPosition(0, 5);
    expect(doc.deleteForward()).toBe("\n");
    expect(doc.getText()).toBe("helloworld");
    expect(doc.position).toEqual({ line: 0, grapheme: 5 });
  });

  it("remembers the goal column when moving vertically (vim sticky column)", () => {
    const doc = new TextDocument("abcdef\nab\nabcdef");
    doc.setPosition(0, 5);
    doc.moveDown();
    expect(doc.position).toEqual({ line: 1, grapheme: 2 }); // 短行被夹到行尾
    doc.moveDown();
    expect(doc.position).toEqual({ line: 2, grapheme: 5 }); // 回到目标列
    doc.moveUp();
    expect(doc.position).toEqual({ line: 1, grapheme: 2 });
  });

  it("resets the goal column after horizontal movement", () => {
    const doc = new TextDocument("abcdef\nab\nabcdef");
    doc.setPosition(0, 5);
    doc.moveDown();
    doc.moveLeft();
    doc.moveUp();
    expect(doc.position).toEqual({ line: 0, grapheme: 1 }); // 水平移动后不再记忆
  });

  it("clamps the cursor for normal mode", () => {
    const doc = new TextDocument("ab\n");
    doc.moveLineEnd(); // insert 模式：行尾之后
    expect(doc.position.grapheme).toBe(2);
    doc.clampToLastGrapheme();
    expect(doc.position.grapheme).toBe(1);
    doc.setPosition(1, 0);
    doc.clampToLastGrapheme(); // 空行停在行首
    expect(doc.position.grapheme).toBe(0);
  });

  it("deletes whole lines with dd semantics", () => {
    const doc = new TextDocument("a\nb\nc");
    doc.setPosition(1, 1);
    expect(doc.deleteLines(1, 1)).toBe("b\n");
    expect(doc.getText()).toBe("a\nc");
    expect(doc.position).toEqual({ line: 1, grapheme: 0 });

    const tail = new TextDocument("a\nb");
    tail.deleteLines(1, 1);
    expect(tail.getText()).toBe("a");

    const head = new TextDocument("a\nb");
    head.deleteLines(0, 1);
    expect(head.getText()).toBe("b");

    const all = new TextDocument("a\nb\nc");
    all.deleteLines(0, 3);
    expect(all.getText()).toBe("");
    expect(all.lineCount).toBe(1);
  });

  it("records edit operations for undo", () => {
    const recorder = new RecordingRecorder();
    const doc = new TextDocument("ab");
    doc.setRecorder(recorder);
    doc.setPosition(0, 1);
    doc.insertText("X");
    doc.deleteForward();
    expect(recorder.ops).toEqual([
      { kind: "insert", offset: 1, text: "X" },
      { kind: "delete", offset: 2, text: "b" },
    ]);
  });
});
