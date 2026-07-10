import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import {
  normalizeSmartQuotes,
  planSmartQuoteNormalizationsFromTransactions,
  shouldNormalizeSmartQuoteChange,
  shouldSkipStraightQuoteNormalization,
} from "../utils/straight-quotes";

const milkdownEditorSource = readFileSync(
  new URL("../components/MilkdownEditor/MilkdownEditorPrimitive.tsx", import.meta.url),
  "utf8",
);
const sourceEditorSource = readFileSync(
  new URL("../components/SourceEditor/SourceEditor.tsx", import.meta.url),
  "utf8",
);
const straightQuotesSource = readFileSync(
  new URL("../utils/straight-quotes.ts", import.meta.url),
  "utf8",
);

describe("straight quotes policy", () => {
  it("keeps the WYSIWYG fallback module but leaves it unmounted by default", () => {
    // 逻辑文件保留；挂载行保持注释，避免与壳层 NSUserDefaults 方案重复生效。
    expect(straightQuotesSource).toContain("export const straightQuotesPlugin");
    expect(milkdownEditorSource).toContain("// import { straightQuotesPlugin }");
    expect(milkdownEditorSource).toMatch(/\/\/\s*\.use\(straightQuotesPlugin\)/);
    expect(milkdownEditorSource).not.toMatch(/^\s*\.use\(straightQuotesPlugin\)/m);
    // 源码模式本身没有智能引号问题，不要挂引号改写逻辑。
    expect(sourceEditorSource).not.toContain("straightQuotes");
    // keydown 主动插入会与 macOS 默认输入路径双插。
    expect(straightQuotesSource).not.toContain("handleKeyDown");
  });

  it("normalizes curly double and single quotes to ASCII", () => {
    expect(normalizeSmartQuotes("“hello” and ‘world’")).toBe("\"hello\" and 'world'");
  });

  it("reverts ASCII-to-curly rewrites but keeps pure curly inserts (Chinese IME)", () => {
    expect(shouldNormalizeSmartQuoteChange('"', "\u201c")).toBe(true);
    expect(shouldNormalizeSmartQuoteChange("'", "\u2018")).toBe(true);
    expect(shouldNormalizeSmartQuoteChange('""', "\u201c\u201d")).toBe(true);

    // 中文输入法中文标点：从空删除区间纯插入弯引号。
    expect(shouldNormalizeSmartQuoteChange("", "\u201c")).toBe(false);
    expect(shouldNormalizeSmartQuoteChange("", "\u201c\u201d")).toBe(false);
  });

  it("allows pure curly inserts only when insertReplacementText path is armed", () => {
    expect(shouldNormalizeSmartQuoteChange("", "\u201c", { allowPureSmartInsert: true })).toBe(
      true,
    );
    expect(shouldNormalizeSmartQuoteChange("", "\u201c", { allowPureSmartInsert: false })).toBe(
      false,
    );
  });

  it("plans normalization for delayed smart-quote rewrite of an earlier ASCII quote", () => {
    const { state } = createParagraphState('""3');
    // 系统把第一个 ASCII 引号改写成开引号弯引号。
    const transaction = state.tr.insertText("\u201c", 1, 2);
    const plans = planSmartQuoteNormalizationsFromTransactions([transaction]);

    expect(plans).toEqual([{ from: 1, to: 2, insert: '"' }]);
  });

  it("does not plan normalization for pure Chinese curly quote inserts", () => {
    const { state } = createParagraphState("hello");
    const transaction = state.tr.insertText("\u201c\u201d", 6);
    const plans = planSmartQuoteNormalizationsFromTransactions([transaction]);

    expect(plans).toEqual([]);
  });

  it("plans pure curly inserts only when allowPureSmartInsert is armed", () => {
    const { state } = createParagraphState("hello");
    const transaction = state.tr.insertText("\u201c", 6);
    expect(planSmartQuoteNormalizationsFromTransactions([transaction])).toEqual([]);
    expect(
      planSmartQuoteNormalizationsFromTransactions([transaction], {
        allowPureSmartInsert: true,
      }),
    ).toEqual([{ from: 6, to: 7, insert: '"' }]);
  });

  it("skips paste, drop, and composition transactions", () => {
    const paste = { getMeta: (key: unknown) => (key === "paste" ? true : undefined) };
    const drop = { getMeta: (key: unknown) => (key === "uiEvent" ? "drop" : undefined) };
    const composition = {
      getMeta: (key: unknown) => (key === "composition" ? { data: "" } : undefined),
    };

    expect(shouldSkipStraightQuoteNormalization([paste])).toBe(true);
    expect(shouldSkipStraightQuoteNormalization([drop])).toBe(true);
    expect(shouldSkipStraightQuoteNormalization([composition])).toBe(true);
  });
});

function createParagraphState(text: string) {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
    },
  });
  const paragraphContent = text.length > 0 ? [schema.text(text)] : [];
  const doc = schema.node("doc", null, [schema.node("paragraph", null, paragraphContent)]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, Math.min(1 + text.length, doc.content.size - 1)),
  });
  return { schema, doc, state };
}
