import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import type { MarkdownRangeIndex } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import type { HtmlBlockWidget } from "../../src/wysiwyg/widgets/html-block-widget.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";
import {
  clearHtmlSanitizeCache,
  getHtmlSanitizeCacheSize,
} from "../../src/wysiwyg/projections/html-projection.ts";
import { findLayoutDecorationsForTesting } from "../../src/testing.ts";
import { setVirtualTrailingLineActiveEffect } from "../../src/wysiwyg/state/types.ts";

interface ProjectionHarness {
  readonly state: EditorState;
  readonly index: MarkdownRangeIndex;
  readonly diagnostics: WysiwygDiagnostics;
}

function createHtmlHarness(
  doc: string,
  features: readonly ("html" | "tables")[] = ["html"],
): ProjectionHarness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      EditorState.allowMultipleSelections.of(true),
      configureWysiwygProjectionFeatures(features),
      wysiwygProjectionField,
    ],
  });
  return { state, index: state.field(markdownRangeIndexField), diagnostics };
}

function findHtmlWidget(state: EditorState): HtmlBlockWidget | null {
  let widget: HtmlBlockWidget | null = null;
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.wysiwygRole === "html-widget") {
        widget = value.spec.widget as HtmlBlockWidget;
      }
    });
  return widget;
}

describe("M4-a HTML projection", () => {
  it("projects HTMLBlock while keeping inline HTMLTag deferred raw", () => {
    const doc = [
      "Before",
      "",
      "<div><strong>Safe</strong></div>",
      "",
      '<Component value="raw" />',
      "",
    ].join("\n");
    const { state, index } = createHtmlHarness(doc);

    expect(index.byKind("html")).toHaveLength(1);
    expect(index.byKind("deferred-html")).toHaveLength(1);
    expect(inspectWysiwygProjection(state).layoutDecorationCount).toBe(1);
    expect(findHtmlWidget(state)?.value).toMatchObject({
      sanitizedHtml: "<div><strong>Safe</strong></div>",
      placeholder: null,
      selected: false,
    });
  });

  it("keeps an HTMLBlock atomic and protected when inactive, and reveals source when active", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "After", ""].join("\n");
    const { state, index } = createHtmlHarness(doc);
    const html = index.byKind("html")[0];
    const projection = inspectWysiwygProjection(state);

    expect(projection.atomicRangeCount).toBe(1);
    expect(projection.protectedRanges).toContainEqual({ ...html.fullRange, kind: "html" });
    expect(projection.activeSyntaxIds).not.toContain(html.id);

    // 光标移入 HTML 块范围：原位暴露源码，解除原子保护与挂件替换
    const activeState = state.update({
      selection: EditorSelection.cursor(html.fullRange.from),
    }).state;
    const activeProjection = inspectWysiwygProjection(activeState);
    expect(activeProjection.activeSyntaxIds).toContain(html.id);
    expect(activeProjection.atomicRangeCount).toBe(0);
    expect(activeProjection.protectedRanges.some((r) => r.kind === "html")).toBe(false);
    expect(findLayoutDecorationsForTesting(activeState, "html-widget")).toHaveLength(0);
    expect(findLayoutDecorationsForTesting(activeState, "html-source-line")).toHaveLength(1);
  });

  it("routes the HTML block widget through the whole-line replacement contract", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "After", ""].join("\n");
    const { state, index } = createHtmlHarness(doc);
    const html = index.byKind("html")[0];
    const [probe] = findLayoutDecorationsForTesting(state, "html-widget");

    // 不对称 Inclusivity：起点覆盖避免上方幽灵空行，终点不覆盖避免吞并下方换行。
    expect(probe?.spec).toMatchObject({
      block: true,
      inclusiveStart: true,
      inclusiveEnd: false,
    });
    expect(state.doc.lineAt(probe.from).from).toBe(probe.from);
    expect(probe.to).toBe(html.fullRange.to + 1);
  });

  it("fails closed for table/form structure instead of concatenating remaining text", () => {
    const doc = ["Before", "", "<table><tr><td>A</td></tr></table>", "", "After", ""].join("\n");
    const { state } = createHtmlHarness(doc);
    expect(findHtmlWidget(state)?.value.placeholder).toContain("Unsupported or unsafe HTML block");
  });

  it("reuses the bounded sanitize cache by source fingerprint and whitelist version", () => {
    clearHtmlSanitizeCache();
    const doc = ["Before", "", "<div>Same</div>", "", "<div>Same</div>", "", "After", ""].join(
      "\n",
    );
    const { index } = createHtmlHarness(doc);

    expect(index.byKind("html")).toHaveLength(2);
    expect(getHtmlSanitizeCacheSize()).toBe(1);
  });

  it("renders HTML comments as muted source instead of an unsafe placeholder", () => {
    const doc = ["Before", "", "<!-- note -->", "", "After", ""].join("\n");
    const { state, index } = createHtmlHarness(doc);
    expect(index.byKind("html")).toHaveLength(0);
    expect(findHtmlWidget(state)).toBeNull();
    expect(findLayoutDecorationsForTesting(state, "html-comment").length).toBeGreaterThan(0);
  });

  describe("who owns the caret at the end of the document", () => {
    // HTML 块贴在文末时，块的闭区间右端点与虚拟空行的光标是同一个偏移（doc.length）。
    // 规则：虚拟行激活且光标是空光标并停在 doc.length 时，光标属于虚拟行，HTML 不展开源码。
    // 文档必须不带尾随换行：这样 fullRange.to === doc.length，光标才落在块的闭区间内，
    // 两个“拥有者”才真的在争同一个偏移；带尾随换行时光标在块外，用例就测不到这条规则。
    const doc = "Before\n\n<div>End</div>";

    function stateAtEnd() {
      const { state, index } = createHtmlHarness(doc);
      const html = index.byKind("html")[0];
      expect(html.fullRange.to).toBe(state.doc.length);
      return { state, html };
    }

    it("keeps the preview collapsed when the virtual line holds the caret", () => {
      const { state, html } = stateAtEnd();
      const next = state.update({
        selection: EditorSelection.cursor(state.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      expect(inspectWysiwygProjection(next).activeSyntaxIds).not.toContain(html.id);
      expect(findLayoutDecorationsForTesting(next, "html-widget")).toHaveLength(1);
      expect(findLayoutDecorationsForTesting(next, "html-source-line")).toHaveLength(0);
    });

    it("reveals the source for the same caret when the virtual line is not active", () => {
      const { state, html } = stateAtEnd();
      const next = state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;
      expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(html.id);
      expect(findLayoutDecorationsForTesting(next, "html-source-line").length).toBeGreaterThan(0);
    });

    // 折叠 / 展开都是“选区 + 虚拟行标志”同一事务派发。投影字段的更新可能早于虚拟行字段，
    // 若读字段里的旧值，会按上一状态判断，出现一帧闪烁或停在错误状态。
    it("reads the effect of the same transaction when arming (stale field is false)", () => {
      const { state, html } = stateAtEnd();
      const away = state.update({ selection: EditorSelection.cursor(0) }).state;
      const armed = away.update({
        selection: EditorSelection.cursor(away.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      expect(inspectWysiwygProjection(armed).activeSyntaxIds).not.toContain(html.id);
    });

    it("reads the effect of the same transaction when disarming (stale field is true)", () => {
      const { state, html } = stateAtEnd();
      const armed = state.update({
        selection: EditorSelection.cursor(state.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      const away = armed.update({
        selection: EditorSelection.cursor(0),
        effects: setVirtualTrailingLineActiveEffect.of(false),
      }).state;
      const back = away.update({
        selection: EditorSelection.cursor(away.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(false),
      }).state;
      expect(inspectWysiwygProjection(back).activeSyntaxIds).toContain(html.id);
    });

    it("still reveals the source when another caret sits inside the block (multi-cursor)", () => {
      // “虚拟行持有文末光标”只豁免停在文末的那个光标。另一个光标若在块内，仍然需要源码可见，
      // 否则用户在块里的光标看不到自己正在编辑的文本。
      const { state, html } = stateAtEnd();
      const next = state.update({
        selection: EditorSelection.create(
          [
            EditorSelection.cursor(html.fullRange.from + 3),
            EditorSelection.cursor(state.doc.length),
          ],
          1,
        ),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(html.id);
    });

    it("does not hide the source for a caret that is not at the document end", () => {
      const { state, html } = stateAtEnd();
      const next = state.update({
        selection: EditorSelection.cursor(html.fullRange.from + 3),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(html.id);
    });

    it("does not hide the source for a range selection that merely ends at the document end", () => {
      const { state, html } = stateAtEnd();
      const next = state.update({
        selection: EditorSelection.range(html.fullRange.from + 2, state.doc.length),
        effects: setVirtualTrailingLineActiveEffect.of(true),
      }).state;
      expect(inspectWysiwygProjection(next).activeSyntaxIds).toContain(html.id);
    });
  });

  it("does not project HTML when the feature is disabled", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "After", ""].join("\n");
    const { state, index } = createHtmlHarness(doc, []);
    expect(index.byKind("html")).toHaveLength(1);
    expect(inspectWysiwygProjection(state)).toMatchObject({
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
      protectedRanges: [],
    });
  });
});
