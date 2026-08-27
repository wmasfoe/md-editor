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
} from "../../src/wysiwyg/projection-state.ts";
import {
  clearHtmlSanitizeCache,
  getHtmlSanitizeCacheSize,
} from "../../src/wysiwyg/html-projection.ts";

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

  it("keeps an HTMLBlock atomic and protected over its exact source range", () => {
    const doc = ["Before", "", "<div>Safe</div>", "", "After", ""].join("\n");
    const { state, index } = createHtmlHarness(doc);
    const html = index.byKind("html")[0];
    const projection = inspectWysiwygProjection(state);

    expect(projection.atomicRangeCount).toBe(1);
    expect(projection.protectedRanges).toContainEqual({ ...html.fullRange, kind: "html" });
    expect(projection.activeSyntaxIds).not.toContain(html.id);
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
