import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { addBlockBelow, moveBlock, readBlockRanges } from "../../src/wysiwyg/block-move.ts";

function createView(doc: string): { view: EditorView; getState: () => EditorState } {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      history(),
      markdownRangeIndexField,
    ],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
    focus() {
      /* 测试环境无真实焦点 */
    },
  } as unknown as EditorView;
  return { view, getState: () => state };
}

/** 取指定内容的块起点(按文本包含匹配) */
function blockFrom(state: EditorState, contains: string): number {
  const line = state.doc
    .toString()
    .split("\n")
    .findIndex((text) => text.includes(contains));
  expect(line).toBeGreaterThanOrEqual(0);
  return state.doc.line(line + 1).from;
}

describe("块移动:块范围解析", () => {
  it("混合文档生成块范围(标题/段落/列表项/代码块)", () => {
    const doc = [
      "# 标题",
      "",
      "段落一",
      "",
      "- 列表甲",
      "- 列表乙",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const { getState } = createView(doc);
    const ranges = readBlockRanges(getState());
    const names = ranges.map((range) => range.name);
    expect(names).toContain("heading-atx");
    expect(names).toContain("paragraph");
    expect(names).toContain("list-item");
    expect(names).toContain("deferred-code");
    // 排序且无嵌套重叠
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index].from).toBeGreaterThanOrEqual(ranges[index - 1].to);
    }
  });

  it("列表项深度由缩进推导", () => {
    const doc = ["- 一级", "  - 二级", "    - 三级", ""].join("\n");
    const { getState } = createView(doc);
    const ranges = readBlockRanges(getState()).filter((range) =>
      range.name.startsWith("list-item"),
    );
    expect(ranges.map((range) => range.depth)).toEqual([0, 1, 2]);
  });
});

describe("块移动:段落移动", () => {
  it("后移:源块移到目标块之后,空行归一为 2", () => {
    const doc = ["段落一", "", "段落二", "", "段落三", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落一");
    const target = blockFrom(getState(), "段落三");
    expect(moveBlock(view, source, target, "after")).toBe(true);
    const moved = getState().doc.toString();
    expect(moved).toContain("段落二\n\n段落三\n\n段落一\n");
  });

  it("前移:源块移到目标块之前", () => {
    const doc = ["段落一", "", "段落二", "", "段落三", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落三");
    const target = blockFrom(getState(), "段落一");
    expect(moveBlock(view, source, target, "before")).toBe(true);
    const moved = getState().doc.toString();
    expect(moved).toContain("段落三\n\n段落一\n\n段落二\n");
  });

  it("移动是单事务:undo 一次恢复原状", () => {
    const doc = ["段落一", "", "段落二", "", "段落三", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落一");
    const target = blockFrom(getState(), "段落三");
    moveBlock(view, source, target, "after");
    expect(getState().doc.toString()).toContain("段落三\n\n段落一\n");
    // 单事务 undo:一次撤销恢复原文档
    expect(undo(view)).toBe(true);
    expect(getState().doc.toString()).toBe(doc);
  });

  it("无效源/目标返回 false 且文档不变", () => {
    const doc = ["段落一", "", "段落二", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落一");
    expect(moveBlock(view, source, source, "after")).toBe(false);
    expect(moveBlock(view, 3, source, "after")).toBe(false);
    expect(getState().doc.toString()).toBe(doc);
  });
});

describe("块移动:列表语义", () => {
  it("同级列表项移动保持缩进", () => {
    const doc = ["- 甲", "- 乙", "- 丙", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "甲");
    const target = blockFrom(getState(), "丙");
    expect(moveBlock(view, source, target, "after", 0)).toBe(true);
    const moved = getState().doc.toString();
    expect(moved.split("\n")).toEqual(["- 乙", "- 丙", "- 甲", ""]);
  });

  it("拖入列表自动加 marker(段落变列表项)", () => {
    const doc = ["段落文本", "", "- 目标项", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落文本");
    const target = blockFrom(getState(), "目标项");
    expect(moveBlock(view, source, target, "after", 0)).toBe(true);
    const moved = getState().doc.toString();
    // 段落变为带 marker 的列表项,与前项同缩进
    expect(moved.split("\n")).toContain("- 段落文本");
  });

  it("嵌套层级钳制:请求过深层级时缩进不破坏解析", () => {
    const doc = ["- 甲", "- 乙", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "甲");
    const target = blockFrom(getState(), "乙");
    // 请求 depth 99 → 钳制到合法深度(乙的子项,缩进 2 空格)
    expect(moveBlock(view, source, target, "after", 99)).toBe(true);
    const moved = getState().doc.toString();
    expect(moved.split("\n")).toEqual(["- 乙", "  - 甲", ""]);
  });
});

describe("块移动:添加块", () => {
  it("在块下方插入空行", () => {
    const doc = ["段落一", "", "段落二", ""].join("\n");
    const { view, getState } = createView(doc);
    const source = blockFrom(getState(), "段落一");
    expect(addBlockBelow(view, source)).toBe(true);
    const moved = getState().doc.toString();
    expect(moved).toContain("段落一\n\n");
  });
});
