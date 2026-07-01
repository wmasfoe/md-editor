import { describe, expect, it } from "vitest";
import { Schema, Slice } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  calculateAiEditPreviewMirrorPlacement,
  createAiContinuationAcceptTransaction,
  createAiEditAcceptTransaction,
  createAiEditPreviewModel,
  isAiEditPreviewGeometryReady,
  showAiSuggestion
} from "../utils/ai-suggestion";

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

  it("replaces the anchored original text when accepting an edit suggestion", () => {
    const schema = createMarkdownLikeSchema();
    const text = "时代少年团深受粉丝的喜爱。笑死我了";
    const original = "笑死我了";
    const from = 1 + text.indexOf(original);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text(text))
      ])
    });

    const transaction = createAiEditAcceptTransaction(state, {
      original,
      replacement: "笑死我了，\nsss，哈哈哈",
      from,
      to: from + original.length
    });

    expect(state.apply(transaction).doc.textContent).toBe(
      "时代少年团深受粉丝的喜爱。笑死我了，\nsss，哈哈哈"
    );
  });

  it("derives a scoped edit preview model for plain textblocks", () => {
    const schema = createMarkdownLikeSchema();
    const text = "hello broken text after";
    const original = "broken";
    const replacement = "fixed text that can wrap";
    const from = 1 + text.indexOf(original);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text(text))
      ])
    });

    expect(createAiEditPreviewModel(state.doc, {
      original,
      replacement,
      from,
      to: from + original.length
    })).toEqual({
      textblockFrom: 1,
      textblockTo: 1 + text.length,
      before: "hello ",
      original,
      replacement,
      after: " text after"
    });
  });

  it("fails closed for rich inline edit preview targets", () => {
    const schema = createMarkdownLikeSchema();
    const markedText = schema.text("broken", [schema.marks.link.create({ href: "https://example.com" })]);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
          schema.text("hello "),
          markedText,
          schema.text(" text after")
        ])
      ])
    });
    const from = 1 + "hello ".length;

    expect(createAiEditPreviewModel(state.doc, {
      original: "broken",
      replacement: "fixed",
      from,
      to: from + "broken".length
    })).toBeNull();
  });

  it("does not leave an unsupported rich inline edit suggestion active", () => {
    const schema = createMarkdownLikeSchema();
    const text = "hello broken text after";
    const markedText = schema.text("broken", [schema.marks.link.create({ href: "https://example.com" })]);
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("hello "),
        markedText,
        schema.text(" text after")
      ])
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1 + text.length)
    });
    const dispatched: { current: Transaction | null } = { current: null };
    const view = {
      state,
      dispatch(transaction: Transaction) {
        dispatched.current = transaction;
      }
    } as unknown as EditorView;

    showAiSuggestion(view, 1, {
      edit: {
        original: "broken",
        replacement: "fixed"
      }
    });

    expect(dispatched.current).toBeNull();
  });

  it("treats missing edit preview geometry as fail-closed", () => {
    expect(isAiEditPreviewGeometryReady(null)).toBe(false);
    expect(isAiEditPreviewGeometryReady({ left: 12, top: 20, width: 0, height: 24 })).toBe(false);
    expect(isAiEditPreviewGeometryReady({ left: 12, top: 20, width: 300, height: 24 })).toBe(true);
  });

  it("positions the mirror from a zero-size anchor and textblock content box", () => {
    expect(calculateAiEditPreviewMirrorPlacement(
      { left: 80, top: 40 },
      { left: 100, top: 60, width: 320, height: 48 },
      {
        paddingLeft: "12px",
        paddingRight: "20px",
        paddingTop: "4px",
        fontSize: "16px",
        font: "16px sans-serif",
        lineHeight: "24px",
        letterSpacing: "0px",
        textAlign: "start",
        tabSize: "4"
      }
    )).toEqual({
      left: "32px",
      top: "6px",
      width: "288px",
      font: "16px sans-serif",
      lineHeight: "24px",
      letterSpacing: "0px",
      textAlign: "start",
      tabSize: "4"
    });

    expect(calculateAiEditPreviewMirrorPlacement(
      { left: 80, top: 40 },
      { left: 100, top: 60, width: 0, height: 48 },
      {
        paddingLeft: "12px",
        paddingRight: "20px",
        paddingTop: "4px",
        fontSize: "16px",
        font: "16px sans-serif",
        lineHeight: "24px",
        letterSpacing: "0px",
        textAlign: "start",
        tabSize: "4"
      }
    )).toBeNull();

    expect(calculateAiEditPreviewMirrorPlacement(
      { left: 80, top: 40 },
      { left: 100, top: 60, width: 320, height: 48 },
      {
        paddingLeft: "12px",
        paddingRight: "20px",
        paddingTop: "4px",
        fontSize: "20px",
        font: "700 20px sans-serif",
        lineHeight: "normal",
        letterSpacing: "0px",
        textAlign: "start",
        tabSize: "4"
      }
    )?.top).toBe("6px");
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
    },
    marks: {
      link: {
        attrs: { href: {} },
        inclusive: false,
        toDOM: (node) => ["a", { href: node.attrs.href }, 0],
        parseDOM: [{ tag: "a[href]", getAttrs: (node) => ({ href: (node as Element).getAttribute("href") }) }]
      }
    }
  });
}
