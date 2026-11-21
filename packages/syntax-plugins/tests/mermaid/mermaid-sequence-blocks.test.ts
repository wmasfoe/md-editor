import { parse } from "@visimer/core";
import { describe, expect, it } from "vitest";
import {
  listSequenceBlockBranches,
  sequenceBlockConditionEdit,
  sequenceConditionError,
  SEQUENCE_BLOCK_KEYWORDS,
} from "../../src/mermaid/mermaid-sequence-blocks.ts";

/** 把补丁应用到源码，用于断言「只改这一行、其它字节不动」。 */
function apply(source: string, edit: { start: number; end: number; text: string }): string {
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end);
}

const BLOCK_SOURCE = `sequenceDiagram
    autonumber
    actor User as 用户
    participant CM as CodeMirror 编辑器
    User->>CM: 打开
    alt 首次加载 (未缓存)
        CM-->>User: ok
    else 已加载
        CM-->>User: no
    end
    CM-->>User: done`;

describe("sequence block branches", () => {
  it("lists every branch of an alt/else block with its condition", () => {
    expect(listSequenceBlockBranches(parse(BLOCK_SOURCE))).toEqual([
      { lineIndex: 5, keyword: "alt", condition: "首次加载 (未缓存)", depth: 1 },
      { lineIndex: 7, keyword: "else", condition: "已加载", depth: 1 },
    ]);
  });

  it("reports nesting depth for nested fragments", () => {
    const source = `sequenceDiagram
 A->>B: one
 alt outer
   A->>B: two
   loop inner
     A->>B: three
   end
 else other
   B->>A: four
 end`;
    expect(
      listSequenceBlockBranches(parse(source)).map(({ keyword, depth }) => [keyword, depth]),
    ).toEqual([
      ["alt", 1],
      ["loop", 2],
      ["else", 1],
    ]);
  });

  it("keeps depth correct across rect/box even though they are not editable", () => {
    const source = `sequenceDiagram
 rect rgb(1,2,3)
   loop inner
     A->>B: x
   end
 end
 alt outer
   A->>B: y
 end`;
    expect(
      listSequenceBlockBranches(parse(source)).map(({ keyword, depth }) => [keyword, depth]),
    ).toEqual([
      ["loop", 2],
      ["alt", 1],
    ]);
  });

  it("returns nothing for a diagram without blocks", () => {
    expect(listSequenceBlockBranches(parse("sequenceDiagram\n A->>B: hi"))).toEqual([]);
    expect(listSequenceBlockBranches(parse("flowchart TD\n A-->B"))).toEqual([]);
  });
});

describe("sequence block condition edit", () => {
  it("replaces only the text after the keyword and keeps every other byte", () => {
    const result = parse(BLOCK_SOURCE);
    const edit = sequenceBlockConditionEdit(result, 5, "缓存未命中");
    expect(edit).not.toBeNull();
    const next = apply(BLOCK_SOURCE, edit!);
    expect(next).toBe(BLOCK_SOURCE.replace("首次加载 (未缓存)", "缓存未命中"));
    // 缩进、关键字和后续分支都不受影响。
    expect(next).toContain("    alt 缓存未命中\n");
    expect(next).toContain("    else 已加载\n");
    expect(next.split("\n")).toHaveLength(BLOCK_SOURCE.split("\n").length);
  });

  it("drops the condition and its separator when the value is empty", () => {
    const result = parse(BLOCK_SOURCE);
    const next = apply(BLOCK_SOURCE, sequenceBlockConditionEdit(result, 7, "   ")!);
    expect(next.split("\n")[7]).toBe("    else");
    // 空条件仍然是合法 Mermaid：补丁不整行删除，只清掉关键字之后的文本。
    expect(next.split("\n")[5]).toBe("    alt 首次加载 (未缓存)");
  });

  it("accepts characters outside the label alphabet", () => {
    const result = parse(BLOCK_SOURCE);
    const next = apply(BLOCK_SOURCE, sequenceBlockConditionEdit(result, 5, "x > 0 && [重试]")!);
    expect(next.split("\n")[5]).toBe("    alt x > 0 && [重试]");
  });

  it("reports why a condition cannot be written", () => {
    // Mermaid's sequence lexer parses a block condition as restOfLine `[^#\n;]*`:
    // `#` starts a comment and `;` acts as a newline, and both still pass whole-diagram parsing.
    expect(sequenceConditionError("retry #3")).toBe("comment");
    expect(sequenceConditionError("ok; A->>B: hi")).toBe("separator");
    expect(sequenceConditionError("a\nb")).toBe("multi-line");
    expect(sequenceConditionError("x > 0 && [重试]")).toBeNull();
  });

  it("refuses conditions the sequence lexer would truncate or split", () => {
    const result = parse(BLOCK_SOURCE);
    expect(sequenceBlockConditionEdit(result, 5, "retry #3")).toBeNull();
    expect(sequenceBlockConditionEdit(result, 5, "ok; A->>B: hi")).toBeNull();
  });

  it("refuses a stale line whose keyword no longer matches the snapshot", () => {
    const result = parse(BLOCK_SOURCE);
    expect(sequenceBlockConditionEdit(result, 5, "new", "else")).toBeNull();
    expect(sequenceBlockConditionEdit(result, 5, "new", "alt")).not.toBeNull();
  });

  it("refuses lines that are not editable branches", () => {
    const result = parse(BLOCK_SOURCE);
    expect(sequenceBlockConditionEdit(result, 3, "x")).toBeNull(); // participant
    expect(sequenceBlockConditionEdit(result, 4, "x")).toBeNull(); // message
    expect(sequenceBlockConditionEdit(result, 9, "x")).toBeNull(); // end
    expect(sequenceBlockConditionEdit(result, 999, "x")).toBeNull(); // out of range
    expect(sequenceBlockConditionEdit(result, 5, "a\nb")).toBeNull(); // multi-line
    expect(sequenceBlockConditionEdit(parse("flowchart TD\n A-->B"), 1, "x")).toBeNull();
  });

  it("refuses rect and box lines because their trailing text is not a condition", () => {
    const result = parse(`sequenceDiagram
 rect rgb(1,2,3)
   A->>B: x
 end
 box Aqua Payments
   participant A
   participant B
 end`);
    expect(sequenceBlockConditionEdit(result, 1, "x")).toBeNull();
    expect(sequenceBlockConditionEdit(result, 4, "x")).toBeNull();
  });

  it("exports exactly the branch keywords it supports", () => {
    expect([...SEQUENCE_BLOCK_KEYWORDS].toSorted()).toEqual(
      ["alt", "and", "break", "critical", "else", "loop", "opt", "option", "par"].toSorted(),
    );
  });
});
