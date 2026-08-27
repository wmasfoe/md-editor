import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  refreshWysiwygProjectionEffect,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "../../src/wysiwyg/projection-state.ts";
import { plainTextInputCanMapVisibleMarks } from "../../src/wysiwyg/visible-marks.ts";

const WYSIWYG_FEATURES: readonly WysiwygProjectionFeature[] = [
  "inline-styles",
  "headings",
  "blocks",
  "links",
  "images",
  "thematic-breaks",
  "default-atoms",
  "frontmatter",
  "tables",
  "html",
];

function createHarness(doc: string): {
  readonly state: EditorState;
  readonly diagnostics: WysiwygDiagnostics;
} {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(WYSIWYG_FEATURES),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
    ],
  });
  return { state, diagnostics };
}

/** 模拟用户键入一个字符(单光标空选区) */
function typeAt(
  state: EditorState,
  from: number,
  text: string,
  userEvent = "input.type",
): EditorState {
  return state.update({
    changes: { from, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent,
  }).state;
}

function decorationRanges(set: DecorationSet, documentLength: number): readonly string[] {
  const ranges: string[] = [];
  set.between(0, documentLength, (from, to, value) => {
    ranges.push(
      `${from}:${to}:${String(value.spec.wysiwygRole ?? value.spec.class ?? "")}:${String(value.spec.wysiwygRecordId ?? "")}`,
    );
  });
  return ranges;
}

describe("G004 P0-1 纯文本输入快速路径", () => {
  it("C1-n: visible-marks 在 viewport 或 mode 同轮变化时保守重建", () => {
    const { state } = createHarness("Plain");
    const positioned = state.update({ selection: EditorSelection.cursor(5) }).state;
    const transaction = positioned.update({
      changes: { from: 5, insert: "x" },
      selection: EditorSelection.cursor(6),
      userEvent: "input.type",
    });
    const makeUpdate = (viewportChanged: boolean) =>
      ({
        startState: positioned,
        state: transaction.state,
        transactions: [transaction],
        changes: transaction.changes,
        docChanged: true,
        focusChanged: false,
        viewportChanged,
      }) as unknown as ViewUpdate;

    expect(plainTextInputCanMapVisibleMarks(makeUpdate(true), false, false)).toBe(false);
    expect(plainTextInputCanMapVisibleMarks(makeUpdate(true), false, true)).toBe(true);
    expect(plainTextInputCanMapVisibleMarks(makeUpdate(false), true, true)).toBe(false);
    const aggregated = {
      ...makeUpdate(false),
      transactions: [transaction, transaction],
    } as unknown as ViewUpdate;
    expect(plainTextInputCanMapVisibleMarks(aggregated, false, true)).toBe(false);
  });

  it("C1: 段落内字母输入命中快速路径,跳过 projection 重建", () => {
    const doc = ["Hello world", "", "Tail"].join("\n");
    const { state, diagnostics } = createHarness(doc);
    const before = diagnostics.snapshot();
    const typed = typeAt(state, 5, "x");
    const after = diagnostics.snapshot();
    expect(typed.doc.toString()).toBe("Hellox world\n\nTail");
    expect(after.projectionMapSkipCount).toBe(before.projectionMapSkipCount + 1);
    expect(after.fullProjectionBuildCount).toBe(before.fullProjectionBuildCount);
    // visible-marks 的快速路径命中计数在 ViewPlugin 层(E2E/真实 view 环境验证)。
  });

  it("C1-n: 结构字符输入不走快速路径(可能产生新语法结构)", () => {
    const doc = ["Hello world", ""].join("\n");
    const { state, diagnostics } = createHarness(doc);
    const typed = typeAt(state, 5, "*");
    expect(typed.doc.toString()).toBe("Hello* world\n");
    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(0);
  });

  it("C1: Unicode 字母/组合标记/数字命中,其余字符保守回退", () => {
    const accepted = ["中", "e\u0301", "\u0301", "𐐷", "𝟘"];
    const rejected = ["🙂", "\u200d", "\ufe0f", " ", "\n", ".", "*"];

    for (const text of accepted) {
      const { state, diagnostics } = createHarness("Plain");
      const positioned = state.update({ selection: EditorSelection.cursor(5) }).state;
      typeAt(positioned, 5, text);
      expect(diagnostics.snapshot().projectionMapSkipCount).toBe(1);
    }
    for (const text of rejected) {
      const { state, diagnostics } = createHarness("Plain");
      const positioned = state.update({ selection: EditorSelection.cursor(5) }).state;
      typeAt(positioned, 5, text);
      expect(diagnostics.snapshot().projectionMapSkipCount).toBe(0);
    }
  });

  it("C1-n: 表格/代码块/HTML 内部输入不走快速路径", () => {
    const fixtures: ReadonlyArray<{
      readonly doc: string;
      readonly kind: "table" | "deferred-code" | "html";
    }> = [
      {
        doc: ["| a | b |", "| --- | --- |", "| x | y |", ""].join("\n"),
        kind: "table",
      },
      { doc: ["```ts", "const x = 1;", "```", ""].join("\n"), kind: "deferred-code" },
      { doc: ["<div>safe</div>", ""].join("\n"), kind: "html" },
    ];

    for (const fixture of fixtures) {
      const { state, diagnostics } = createHarness(fixture.doc);
      const record = state.field(markdownRangeIndexField).byKind(fixture.kind)[0];
      if (!record) {
        throw new Error(`Expected a ${fixture.kind} record.`);
      }
      typeAt(state, record.fullRange.from + 2, "z");
      expect(diagnostics.snapshot().projectionMapSkipCount).toBe(0);
    }
  });

  it("C1-n: 多光标纯文本输入不走快速路径", () => {
    const { state, diagnostics } = createHarness("abcd");
    const selected = state.update({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
    }).state;
    const typed = selected.update({
      changes: [
        { from: 1, insert: "x" },
        { from: 3, insert: "y" },
      ],
      userEvent: "input.type",
    }).state;
    expect(typed.doc.toString()).toBe("axbcyd");
    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(0);
    expect(typed.field(wysiwygProjectionField).typedBoundary).toBeNull();
  });

  it("C2: 结构记录 ID 因前方插入变化时回退重建", () => {
    const { state, diagnostics } = createHarness("A [text](url)");
    const positioned = state.update({ selection: EditorSelection.cursor(1) }).state;
    const typed = typeAt(positioned, 1, "x");
    const index = typed.field(markdownRangeIndexField);
    const validIds = new Set(index.records.map((record) => record.id));
    const projection = typed.field(wysiwygProjectionField);
    const staleIds: string[] = [];
    for (const decorations of [projection.layoutDecorations, projection.atomicRanges]) {
      decorations.between(0, typed.doc.length, (_from, _to, value) => {
        const recordId = String(value.spec.wysiwygRecordId ?? "");
        if (recordId && !validIds.has(recordId)) staleIds.push(recordId);
      });
    }

    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(0);
    expect(staleIds).toEqual([]);
  });

  it("C2: 快速路径的 decoration 与 protected range 等价于纯 map", () => {
    const doc = ["**bold**", "", "Plain text", "", "---", "x", ""].join("\n");
    const { state, diagnostics } = createHarness(doc);
    // 插入点放在文档末尾文本行之后:其后无任何结构记录,record ID 保持稳定,
    // 同时 bold/thematic-break 装饰都参与映射,可验证 map 语义等价。
    const insertion = doc.indexOf("x") + 1;
    const positioned = state.update({ selection: EditorSelection.cursor(insertion) }).state;
    const previous = positioned.field(wysiwygProjectionField);
    const transaction = positioned.update({
      changes: { from: insertion, insert: "y" },
      selection: EditorSelection.cursor(insertion + 1),
      userEvent: "input.type",
    });
    const nextState = transaction.state;
    const next = nextState.field(wysiwygProjectionField);

    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(1);
    expect(decorationRanges(next.layoutDecorations, nextState.doc.length)).toEqual(
      decorationRanges(previous.layoutDecorations.map(transaction.changes), nextState.doc.length),
    );
    expect(decorationRanges(next.atomicRanges, nextState.doc.length)).toEqual(
      decorationRanges(previous.atomicRanges.map(transaction.changes), nextState.doc.length),
    );
    expect(next.protectedRanges).toEqual(
      previous.protectedRanges.map((range) => ({
        ...range,
        from: transaction.changes.mapPos(range.from, -1),
        to: transaction.changes.mapPos(range.to, 1),
      })),
    );

    const refreshedState = nextState.update({
      effects: refreshWysiwygProjectionEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const refreshed = refreshedState.field(wysiwygProjectionField);
    expect(decorationRanges(next.layoutDecorations, nextState.doc.length)).toEqual(
      decorationRanges(refreshed.layoutDecorations, refreshedState.doc.length),
    );
    expect(decorationRanges(next.atomicRanges, nextState.doc.length)).toEqual(
      decorationRanges(refreshed.atomicRanges, refreshedState.doc.length),
    );
    expect(next.protectedRanges).toEqual(refreshed.protectedRanges);
  });

  it("C3: 大文档连续纯文本输入不触发投影全量重建", () => {
    const lines = Array.from({ length: 2000 }, (_unused, index) => `Line ${index} content`).join(
      "\n",
    );
    const { state, diagnostics } = createHarness(lines);
    const before = diagnostics.snapshot();
    let next = state;
    for (let index = 0; index < 50; index += 1) {
      next = typeAt(next, index, "x");
    }
    const after = diagnostics.snapshot();
    expect(after.projectionMapSkipCount).toBeGreaterThan(before.projectionMapSkipCount);
    expect(after.fullProjectionBuildCount).toBe(before.fullProjectionBuildCount);
  });
});

describe("G004 P0-2 composition 输入", () => {
  it("C4: composition guard 存在时仍只 map,并同步映射 guard ranges", () => {
    const { state, diagnostics } = createHarness("abcd");
    const guarded = state.update({
      effects: startWysiwygCompositionGuardEffect.of([{ from: 1, to: 3 }]),
    }).state;
    const before = diagnostics.snapshot();
    const composed = typeAt(guarded, 0, "中", "input.type.compose");
    const after = diagnostics.snapshot();
    expect(after.compositionMapSkipCount).toBe(before.compositionMapSkipCount + 1);
    expect(after.fullProjectionBuildCount).toBe(before.fullProjectionBuildCount);
    expect(composed.field(wysiwygProjectionField).compositionGuardRanges).toEqual([
      { from: 2, to: 4 },
    ]);
  });

  it("C4: composition 输入只 map;compositionend 空事务触发一次全量重建", () => {
    const doc = ["Hello", ""].join("\n");
    const { state, diagnostics } = createHarness(doc);
    const before = diagnostics.snapshot();
    // composition 中的输入(中文 IME)
    const composed = typeAt(state, 5, "中", "input.type.compose");
    const mid = diagnostics.snapshot();
    expect(mid.compositionMapSkipCount).toBe(before.compositionMapSkipCount + 1);
    expect(mid.fullProjectionBuildCount).toBe(before.fullProjectionBuildCount);
    // compositionend:renderer 派发 refresh effect 空事务 → 全量重建一次。
    // 注意:Transaction.state 是惰性求值,必须访问 .state 才会执行 StateField.update。
    const refreshed = composed.update({
      effects: refreshWysiwygProjectionEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
    void refreshed.state;
    const after = diagnostics.snapshot();
    expect(after.fullProjectionBuildCount).toBe(mid.fullProjectionBuildCount + 1);
  });
});

describe("G004 P0-3 typedBoundary", () => {
  it("C6: 纯文本输入保存最新边界,同段落移动光标时清空", () => {
    const { state } = createHarness("Hello");
    const typed = typeAt(state, 5, "x");
    expect(typed.field(wysiwygProjectionField).typedBoundary).toBe(6);

    const moved = typed.update({ selection: EditorSelection.cursor(0) }).state;
    expect(moved.field(wysiwygProjectionField).typedBoundary).toBeNull();
  });

  it("C6: 全量刷新重建后保留当前输入边界", () => {
    const { state } = createHarness("");
    const linkMarkdown = "[text](https://example.com)";
    let typed = state;
    for (let index = 0; index < linkMarkdown.length; index += 1) {
      typed = typeAt(typed, index, linkMarkdown[index], "input.type");
    }
    const boundary = typed.selection.main.head;
    expect(typed.field(wysiwygProjectionField).typedBoundary).toBe(boundary);

    const refreshed = typed.update({
      effects: refreshWysiwygProjectionEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(refreshed.field(wysiwygProjectionField).typedBoundary).toBe(boundary);
  });

  it("C5: 输入 [text](url) 闭合 ) 后 link 记录保持 active;光标移走后恢复", () => {
    const { state } = createHarness("");
    const linkMarkdown = "[text](https://example.com)";
    let next = state;
    for (let index = 0; index < linkMarkdown.length; index += 1) {
      next = typeAt(next, index, linkMarkdown[index], "input.type");
    }
    const link = next.field(markdownRangeIndexField).byKind("link")[0];
    if (!link) {
      throw new Error("Expected a link record.");
    }
    // 光标 === 闭合符右缘 === typedBoundary → 宽松 reveal 生效
    expect(next.selection.main.head).toBe(link.fullRange.to);
    expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(link.id);
    // 光标移到链接起点之外(selection 变化)→ typedBoundary 清空 → 不再 active
    const moved = next.update({ selection: EditorSelection.cursor(link.fullRange.from) }).state;
    expect(inspectWysiwygProjection(moved).activeSyntaxIds).not.toContain(link.id);
  });

  it("C6: 非输入 doc 变化(删除)清空 typedBoundary,链接立即收起", () => {
    const { state } = createHarness("");
    const linkMarkdown = "[text](https://example.com)";
    let next = state;
    for (let index = 0; index < linkMarkdown.length; index += 1) {
      next = typeAt(next, index, linkMarkdown[index], "input.type");
    }
    const link = next.field(markdownRangeIndexField).byKind("link")[0];
    if (!link) {
      throw new Error("Expected a link record.");
    }
    // 刚输入完,光标在闭合符右缘 → 保持 active
    expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(link.id);
    // 删除一个字符(非纯输入 doc 变化)→ typedBoundary 清空,链接收起
    const deleted = next.update({
      changes: { from: link.fullRange.to - 1, to: link.fullRange.to },
      userEvent: "delete.backward",
    }).state;
    expect(inspectWysiwygProjection(deleted).activeSyntaxIds).not.toContain(link.id);
  });
});
