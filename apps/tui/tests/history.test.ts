import { describe, expect, it } from "vitest";
import { DocumentHistory } from "../src/document/history.ts";
import { TextDocument } from "../src/document/text-document.ts";

function makeDoc(text = "") {
  const doc = new TextDocument(text);
  const history = new DocumentHistory(doc);
  doc.setRecorder(history);
  return { doc, history };
}

describe("DocumentHistory", () => {
  it("undoes and redoes a whole group of typed characters", () => {
    const { doc, history } = makeDoc();
    doc.insertText("abc");
    history.flush();
    expect(doc.getText()).toBe("abc");
    expect(history.canUndo).toBe(true);
    expect(history.undo()).toBe(true);
    expect(doc.getText()).toBe("");
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(true);
    expect(doc.getText()).toBe("abc");
  });

  it("undoes group by group in order", () => {
    const { doc, history } = makeDoc();
    doc.insertText("ab");
    history.flush();
    doc.insertText("cd");
    history.flush();
    history.undo();
    expect(doc.getText()).toBe("ab");
    history.undo();
    expect(doc.getText()).toBe("");
    expect(history.canUndo).toBe(false);
    history.redo();
    history.redo();
    expect(doc.getText()).toBe("abcd");
  });

  it("flushes pending edits before undoing", () => {
    const { doc, history } = makeDoc();
    doc.insertText("xyz");
    // 未手动 flush：undo 应先收尾当前输入组再撤销
    expect(history.undo()).toBe(true);
    expect(doc.getText()).toBe("");
  });

  it("restores deleted text on undo", () => {
    const { doc, history } = makeDoc("hello");
    history.flush(); // 空组不入栈
    doc.setPosition(0, 5);
    doc.deleteBackward();
    doc.deleteBackward();
    doc.deleteBackward();
    history.flush();
    expect(doc.getText()).toBe("he");
    history.undo();
    expect(doc.getText()).toBe("hello");
    expect(doc.offset).toBe(2); // 光标回到被撤销改动处
  });

  it("handles CJK edits", () => {
    const { doc, history } = makeDoc();
    doc.insertText("中文测试");
    history.flush();
    history.undo();
    expect(doc.getText()).toBe("");
    history.redo();
    expect(doc.getText()).toBe("中文测试");
  });

  it("clears the redo stack when a new edit happens after undo", () => {
    const { doc, history } = makeDoc();
    doc.insertText("abc");
    history.flush();
    history.undo();
    doc.insertText("Z");
    history.flush();
    expect(history.canRedo).toBe(false);
    expect(doc.getText()).toBe("Z");
  });

  it("stops at the bottom of the stack without throwing", () => {
    const { history } = makeDoc();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it("does not record undo/redo replays as new edits", () => {
    const { doc, history } = makeDoc();
    doc.insertText("ab");
    history.flush();
    history.undo(); // 回放期间不得产生新的 undo 组
    expect(history.canUndo).toBe(false);
    history.redo();
    history.flush();
    expect(history.canRedo).toBe(false);
    expect(doc.getText()).toBe("ab");
  });
});
