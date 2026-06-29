import { describe, expect, it } from "vitest";
import { Schema, Slice } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createAiContinuationAcceptTransaction, showAiSuggestion } from "../utils/ai-suggestion";

describe("AI suggestion acceptance", () => {
  it("shows a continuation without moving the real editor selection", () => {
    const schema = createMarkdownLikeSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("Intro"))
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 6)
    });
    const dispatched: { current: Transaction | null } = { current: null };
    const view = {
      state,
      dispatch(transaction: Transaction) {
        dispatched.current = transaction;
      }
    } as unknown as EditorView;

    showAiSuggestion(view, 1, { continuation: " AI suggestion" });

    expect(dispatched.current?.selectionSet).toBe(true);
    expect(dispatched.current?.selection.from).toBe(state.selection.from);
    expect(dispatched.current?.selection.to).toBe(state.selection.to);
  });

  it("inserts accepted continuation as parsed Markdown structure", () => {
    const schema = createMarkdownLikeSchema();
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text("Intro"))
      ])
    });
    const parsedContinuation = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("明确审核流程包括以下几个步骤：")),
      schema.nodes.ordered_list.create({ order: 1 }, [
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("提交审核请求"))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("自动审核")))
      ]),
      schema.nodes.paragraph.create(null, schema.text("关键点包括：")),
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("审核效率"))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("审核准确性")))
      ])
    ]);

    const transaction = createAiContinuationAcceptTransaction(
      state,
      state.doc.content.size,
      "明确审核流程包括以下几个步骤：\n\n1. 提交审核请求\n2. 自动审核\n\n关键点包括：\n\n- 审核效率\n- 审核准确性",
      () => new Slice(parsedContinuation.content, 0, 0)
    );
    const nextState = state.apply(transaction);

    expect(nextState.doc.child(1).type.name).toBe("paragraph");
    expect(nextState.doc.child(2).type.name).toBe("ordered_list");
    expect(nextState.doc.child(3).type.name).toBe("paragraph");
    expect(nextState.doc.child(4).type.name).toBe("bullet_list");
    expect(nextState.doc.textContent).toContain("Intro明确审核流程");
    expect(nextState.doc.textContent).toContain("提交审核请求");
    expect(nextState.doc.textContent).toContain("审核准确性");
  });

  it("keeps a leading Markdown block break so headings do not collapse into text", () => {
    const schema = createMarkdownLikeSchema();
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text("Intro"))
      ])
    });
    const parsedContinuation = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 3 }, schema.text("需求分析")),
      schema.nodes.ordered_list.create({ order: 1 }, [
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("审核触发条件"))),
        schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("审核标准")))
      ])
    ]);

    const transaction = createAiContinuationAcceptTransaction(
      state,
      6,
      "\n\n### 需求分析\n\n1. 审核触发条件\n2. 审核标准",
      (markdown) => {
        expect(markdown).toBe("\n\n### 需求分析\n\n1. 审核触发条件\n2. 审核标准");
        return new Slice(parsedContinuation.content, 0, 0);
      }
    );
    const nextState = state.apply(transaction);

    expect(nextState.doc.child(0).type.name).toBe("paragraph");
    expect(nextState.doc.child(0).textContent).toBe("Intro");
    expect(nextState.doc.child(1).type.name).toBe("heading");
    expect(nextState.doc.child(1).attrs.level).toBe(3);
    expect(nextState.doc.child(1).textContent).toBe("需求分析");
    expect(nextState.doc.child(2).type.name).toBe("ordered_list");
  });

  it("falls back to plain text when Markdown parsing cannot produce a slice", () => {
    const schema = createMarkdownLikeSchema();
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text("Intro"))
      ])
    });

    const transaction = createAiContinuationAcceptTransaction(
      state,
      6,
      "1. plain fallback",
      () => {
        throw new Error("parser unavailable");
      }
    );

    expect(state.apply(transaction).doc.textContent).toBe("Intro1. plain fallback");
  });
});

function createMarkdownLikeSchema() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      heading: {
        content: "inline*",
        group: "block",
        attrs: { level: { default: 1 } }
      },
      ordered_list: {
        content: "list_item+",
        group: "block",
        attrs: { order: { default: 1 } }
      },
      bullet_list: { content: "list_item+", group: "block" },
      list_item: { content: "paragraph block*" },
      text: { group: "inline" }
    }
  });
}
