import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { getM3TableFixture } from "../../src/markdown/fixtures.ts";
import {
  markdownRangeIndexField,
  mdxModeFacet,
  type MarkdownRangeIndex,
} from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "../../src/wysiwyg/projection-state.ts";

const TABLE_DOCUMENT = [
  "| name | role |",
  "| --- | --- |",
  "| alice | admin |",
  "",
  "Tail",
  "",
].join("\n");

const MIXED_DOCUMENT = [
  "| name | role |",
  "| --- | --- |",
  "| alice | admin |",
  "",
  "[^note]",
  "",
  "Tail",
  "",
].join("\n");

const MIXED_HTML_TABLE_DOCUMENT = [
  "| name | role |",
  "| --- | --- |",
  "| alice | admin |",
  "",
  "<div>Safe</div>",
  "",
  "Tail",
  "",
].join("\n");

interface Harness {
  readonly state: EditorState;
  readonly index: MarkdownRangeIndex;
  readonly diagnostics: WysiwygDiagnostics;
}

function createHarness(
  doc: string,
  features: readonly WysiwygProjectionFeature[] = ["tables", "blocks", "default-atoms"],
): Harness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures([...features, "headings"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return { state, index: state.field(markdownRangeIndexField), diagnostics };
}

function createMdxHarness(doc: string): Harness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      mdxModeFacet.of(true),
      configureWysiwygProjectionFeatures(["mdx", "headings"]),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return { state, index: state.field(markdownRangeIndexField), diagnostics };
}

describe("wysiwyg change protection provenance semantics", () => {
  it("rejects an exactly selected footnote deletion and announces source mode", () => {
    const doc = ["Before", "", "[^note]", "", "Tail", ""].join("\n");
    const { state, index } = createHarness(doc);
    const footnote = index.byKind("footnote")[0];
    expect(footnote).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(footnote.fullRange.from, footnote.fullRange.to),
    }).state;
    const attempted = selected.update({
      changes: { from: footnote.fullRange.from, to: footnote.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(footnote.fullRange.from),
      userEvent: "delete.selection",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(doc);
    expect(attempted.state.selection).toEqual(selected.selection);
    expect(attempted.effects.some((effect) => effect.is(EditorView.announce))).toBe(true);
  });

  it("rejects an exactly selected autolink deletion while a strictly wider selection is allowed", () => {
    const doc = ["Before", "", "<https://example.org>", "", "Tail", ""].join("\n");
    const { state, index } = createHarness(doc);
    const autolink = index.byKind("autolink")[0];
    expect(autolink).toBeDefined();

    const exact = state.update({
      selection: EditorSelection.range(autolink.fullRange.from, autolink.fullRange.to),
    }).state;
    const exactDelete = exact.update({
      changes: { from: autolink.fullRange.from, to: autolink.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(autolink.fullRange.from),
      userEvent: "delete.selection",
    });
    expect(exactDelete.docChanged).toBe(false);
    expect(exactDelete.state.doc.toString()).toBe(doc);

    const wide = state.update({
      selection: EditorSelection.range(autolink.fullRange.from - 1, autolink.fullRange.to + 1),
    }).state;
    const wideDelete = wide.update({
      changes: {
        from: autolink.fullRange.from - 1,
        to: autolink.fullRange.to + 1,
        insert: "",
      },
      selection: EditorSelection.cursor(autolink.fullRange.from - 1),
      userEvent: "delete.selection",
    });
    expect(wideDelete.docChanged).toBe(true);
  });

  it("allows typing that exactly replaces a selected table (whole-table replace)", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createHarness(fixture.markdown);
    const table = index.byKind("table")[0];
    expect(table).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, table.fullRange.to),
    }).state;
    const typed = selected.update({
      changes: { from: table.fullRange.from, to: table.fullRange.to, insert: "replacement" },
      selection: EditorSelection.cursor(table.fullRange.from + "replacement".length),
      userEvent: "input.type",
    });

    expect(typed.docChanged).toBe(true);
    expect(typed.state.doc.toString().includes("|")).toBe(false);
    expect(typed.state.doc.toString()).toContain("replacement");
  });

  it("allows a paste that exactly replaces a selected table", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createHarness(fixture.markdown);
    const table = index.byKind("table")[0];
    expect(table).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, table.fullRange.to),
    }).state;
    const pasted = selected.update({
      changes: { from: table.fullRange.from, to: table.fullRange.to, insert: "pasted body" },
      selection: EditorSelection.cursor(table.fullRange.from + "pasted body".length),
      userEvent: "input.paste",
    });

    expect(pasted.docChanged).toBe(true);
    expect(pasted.state.doc.toString()).toContain("pasted body");
  });

  it("allows a Delete on an exactly selected table (deleteSelectedAtomForward path without annotation)", () => {
    const { state, index } = createHarness(TABLE_DOCUMENT);
    const table = index.byKind("table")[0];
    expect(table).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, table.fullRange.to),
    }).state;
    const deleted = selected.update({
      changes: { from: table.fullRange.from, to: table.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(table.fullRange.from),
      userEvent: "delete.selection",
    });

    expect(deleted.docChanged).toBe(true);
    expect(deleted.state.doc.toString().includes("|")).toBe(false);
    expect(deleted.state.doc.toString()).toContain("Tail");
  });

  it("allows an exactly selected HTML block deletion without an authorization annotation", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "Tail", ""].join("\n");
    const { state, index } = createHarness(doc, ["html"]);
    const html = index.byKind("html")[0];
    expect(html).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(html.fullRange.from, html.fullRange.to),
    }).state;
    const deleted = selected.update({
      changes: { from: html.fullRange.from, to: html.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(html.fullRange.from),
      userEvent: "delete.selection",
    });

    expect(deleted.docChanged).toBe(true);
    expect(deleted.state.doc.toString()).not.toContain("<div>Safe</div>");
    expect(deleted.state.doc.toString()).toContain("Tail");
  });

  it("keeps table exact-delete behavior when HTML and table provenance coexist", () => {
    const { state, index } = createHarness(MIXED_HTML_TABLE_DOCUMENT, ["tables", "html"]);
    const table = index.byKind("table")[0];
    const html = index.byKind("html")[0];
    expect(table).toBeDefined();
    expect(html).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, table.fullRange.to),
    }).state;
    const deleted = selected.update({
      changes: { from: table.fullRange.from, to: table.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(table.fullRange.from),
      userEvent: "delete.selection",
    });

    expect(deleted.docChanged).toBe(true);
    expect(deleted.state.doc.toString()).not.toContain("| name | role |");
    expect(deleted.state.doc.toString()).toContain("<div>Safe</div>");
  });

  it("rejects a partial HTML block change", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "Tail", ""].join("\n");
    const { state, index } = createHarness(doc, ["html"]);
    const html = index.byKind("html")[0];
    const inside = html.fullRange.from + 2;
    const attempted = state.update({
      changes: { from: inside, insert: "x" },
      selection: EditorSelection.cursor(inside + 1),
      userEvent: "input.type",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(doc);
  });

  it("rejects a mixed selection that partially hits a footnote while covering a table", () => {
    const { state, index } = createHarness(MIXED_DOCUMENT);
    const table = index.byKind("table")[0];
    const footnote = index.byKind("footnote")[0];
    expect(table).toBeDefined();
    expect(footnote).toBeDefined();

    // 选区覆盖整表但只"部分"覆盖表后 footnote（selection.to 落在 footnote 内部）：
    // 对 footnote provenance 而言不是 covers（更不是 strict-wider），必须整体拒绝。
    const selectionTo = footnote.fullRange.from + 2;
    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, selectionTo),
    }).state;
    const attempted = selected.update({
      changes: { from: table.fullRange.from, to: selectionTo, insert: "x" },
      selection: EditorSelection.cursor(table.fullRange.from + 1),
      userEvent: "input.type",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(MIXED_DOCUMENT);
    expect(attempted.effects.some((effect) => effect.is(EditorView.announce))).toBe(true);
  });

  it("allows a strictly-wider selection that covers both a table and a footnote (G012 cross-block rule)", () => {
    const { state, index } = createHarness(MIXED_DOCUMENT);
    const table = index.byKind("table")[0];
    const footnote = index.byKind("footnote")[0];
    expect(table).toBeDefined();
    expect(footnote).toBeDefined();

    // 跨块宽选区同时覆盖完整 table 与完整 footnote：footnote 被 strict-wider
    // 覆盖（selection.from < footnote.from），按 G012 规则放行。
    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, footnote.fullRange.to),
    }).state;
    const attempted = selected.update({
      changes: { from: table.fullRange.from, to: footnote.fullRange.to, insert: "x" },
      selection: EditorSelection.cursor(table.fullRange.from + 1),
      userEvent: "input.type",
    });

    expect(attempted.docChanged).toBe(true);
    expect(attempted.state.doc.toString().includes("|")).toBe(false);
    expect(attempted.state.doc.toString().includes("[^note]")).toBe(false);
  });

  it("tolerates a trailing newline inside the table replacement selection", () => {
    const { state, index } = createHarness(TABLE_DOCUMENT);
    const table = index.byKind("table")[0];
    expect(table).toBeDefined();
    // 表格布局 decoration 替换范围到 fullRange.to + 1（含尾随换行），
    // 用户拖选"整表+换行"时 selection.to = fullRange.to + 1 仍应放行。
    const selected = state.update({
      selection: EditorSelection.range(table.fullRange.from, table.fullRange.to + 1),
    }).state;
    const typed = selected.update({
      changes: { from: table.fullRange.from, to: table.fullRange.to + 1, insert: "replacement" },
      selection: EditorSelection.cursor(table.fullRange.from + "replacement".length),
      userEvent: "input.type",
    });

    expect(typed.docChanged).toBe(true);
    expect(typed.state.doc.toString().includes("|")).toBe(false);
  });

  it("allows select-all deletion on a document without code blocks (strict-wider covers footnote)", () => {
    const doc = ["Before", "", "[^note]", "", "Tail", ""].join("\n");
    const { state } = createHarness(doc);
    // select-all 选区 (0, len) 对 footnote 是 strict-wider 覆盖（G012 语义），
    // 无代码块时整文档删除应放行；E07-E08 的 select-all 拒绝来自代码块语法保护。
    const selected = state.update({
      selection: EditorSelection.range(0, doc.length),
    }).state;
    const attempted = selected.update({
      changes: { from: 0, to: doc.length, insert: "" },
      selection: EditorSelection.cursor(0),
      userEvent: "delete.selection",
    });

    expect(attempted.docChanged).toBe(true);
    expect(attempted.state.doc.toString()).toBe("");
  });

  it("rejects select-all deletion when the document contains fenced code syntax", () => {
    const doc = ["Before", "", "[^note]", "", "```md", "code", "```", "", "Tail", ""].join("\n");
    const { state } = createHarness(doc);
    const selected = state.update({
      selection: EditorSelection.range(0, doc.length),
    }).state;
    const attempted = selected.update({
      changes: { from: 0, to: doc.length, insert: "" },
      selection: EditorSelection.cursor(0),
      userEvent: "delete.selection",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(doc);
  });

  it("does not weaken protection when a table change is rejected outside the table range", () => {
    const fixture = getM3TableFixture("M3T-F01");
    const { state, index } = createHarness(fixture.markdown);
    const table = index.byKind("table")[0];
    expect(table).toBeDefined();
    // 表格内部普通输入（非整表替换）仍必须被拒绝：provenance 只放宽
    // "恰好相等选区"替换，不改变表格内部结构性输入保护。
    const inside = table.fullRange.from + 4;
    const attempted = state.update({
      changes: { from: inside, insert: "x" },
      selection: EditorSelection.cursor(inside + 1),
      userEvent: "input.type",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(fixture.markdown);
  });

  it("allows an exactly selected MDX component block deletion without an authorization annotation", () => {
    const doc = ["Before", "", '<Callout type="info">', "body", "</Callout>", "", "Tail", ""].join(
      "\n",
    );
    const { state, index } = createMdxHarness(doc);
    const mdx = index.byKind("mdx-jsx")[0];
    expect(mdx).toBeDefined();

    const selected = state.update({
      selection: EditorSelection.range(mdx.fullRange.from, mdx.fullRange.to),
    }).state;
    const deleted = selected.update({
      changes: { from: mdx.fullRange.from, to: mdx.fullRange.to, insert: "" },
      selection: EditorSelection.cursor(mdx.fullRange.from),
      userEvent: "delete.selection",
    });

    expect(deleted.docChanged).toBe(true);
    expect(deleted.state.doc.toString()).not.toContain("<Callout");
    expect(deleted.state.doc.toString()).toContain("Tail");
  });

  it("rejects a partial MDX component block change", () => {
    const doc = ["Before", "", '<Callout type="info">', "body", "</Callout>", "", "Tail", ""].join(
      "\n",
    );
    const { state, index } = createMdxHarness(doc);
    const mdx = index.byKind("mdx-jsx")[0];
    expect(mdx).toBeDefined();

    const inside = mdx.fullRange.from + 12;
    const attempted = state.update({
      changes: { from: inside, insert: "x" },
      selection: EditorSelection.cursor(inside + 1),
      userEvent: "input.type",
    });

    expect(attempted.docChanged).toBe(false);
    expect(attempted.state.doc.toString()).toBe(doc);
  });

  it("tracks provenance kinds on every protected range in the projection snapshot", () => {
    const { state } = createHarness(MIXED_DOCUMENT);
    const projection = inspectWysiwygProjection(state);
    expect(projection.protectedRanges.length).toBeGreaterThan(0);
    for (const range of projection.protectedRanges) {
      expect(range.kind).toMatch(/^(default-atom|frontmatter|block-marker|code|table|html)$/u);
    }
    const kinds = new Set(projection.protectedRanges.map((range) => range.kind));
    expect(kinds).toContain("table");
    expect(kinds).toContain("default-atom");
  });
});
