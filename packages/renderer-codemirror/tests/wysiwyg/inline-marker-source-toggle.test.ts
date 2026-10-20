/**
 * T-12…T-17：`buildInlineStyleDecorations` 的三种形态（ON 常显 / OFF+active 显 / OFF 未触及折叠），
 * 以及四类白名单（本地 test-only 插件不得被隐藏）。
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  markdownRangeIndexField,
  syntaxPluginRegistryFacet,
} from "../../src/markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { editorModeField } from "../../src/mode.ts";
import { SyntaxPluginRegistry } from "../../src/plugins/syntax-registry.ts";
import {
  initialInlineStyleMarkersFacet,
  inlineStyleMarkersField,
} from "../../src/wysiwyg/projections/inline-heading.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";
import { startWysiwygCompositionGuardEffect } from "../../src/wysiwyg/state/types.ts";
import { buildVisibleMarkdownMarks } from "../../src/wysiwyg/state/visible-marks.ts";
import { localInlineMarkdown, localInlinePlugin } from "./support/local-inline-plugin.ts";

const DOC = "Head\n\nxx **bold** yy *it* ~~del~~ `code`\n";

interface Summary {
  readonly from: number;
  readonly to: number;
  readonly role: string;
  readonly kind: string;
  readonly recordId: string;
}

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.single(0),
  showSourceMarkers = false,
) {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: [...M1_MARKDOWN_EXTENSIONS, localInlinePlugin.markdownExtension!] }),
      syntaxPluginRegistryFacet.of(new SyntaxPluginRegistry([localInlinePlugin])),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["inline-styles", "headings"]),
      wysiwygProjectionField,
      inlineStyleMarkersField,
      initialInlineStyleMarkersFacet.of(showSourceMarkers),
    ],
  });
}

function decorations(state: EditorState): readonly Summary[] {
  const set = buildVisibleMarkdownMarks({
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  } as unknown as EditorView);
  const out: Summary[] = [];
  set.between(0, state.doc.length, (from, to, value) => {
    out.push({
      from,
      to,
      role: String(value.spec.wysiwygRole ?? ""),
      kind: String(value.spec.attributes?.["data-markdown-kind"] ?? ""),
      recordId: String(value.spec.wysiwygRecordId ?? ""),
    });
  });
  return out;
}

function recordIdOf(state: EditorState, kind: "bold" | "italic" | "highlight" | "inline-code") {
  const record = state.field(markdownRangeIndexField).byKind(kind)[0];
  expect(record).toBeDefined();
  return record!;
}

describe("buildVisibleMarkdownMarks · 行内标记源码显隐", () => {
  it("T-12: OFF 且未触及时四类 marker 折叠为 replace，内容样式仍在", () => {
    const state = createState(DOC, EditorSelection.single(1));
    const all = decorations(state);

    for (const kind of ["bold", "italic", "strikethrough", "inline-code"]) {
      const caption = recordIdOf(state, kind as never);
      const own = all.filter((item) => item.recordId === caption.id);
      expect(own.filter((item) => item.role === "inline-marker-hidden")).toHaveLength(2);
      expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(0);
      expect(own.filter((item) => item.role === "inline-content")).toHaveLength(1);
    }
  });

  it("T-13: OFF 且光标在记录内部 ⇒ 该记录 marker 可见", () => {
    const base = createState(DOC, EditorSelection.single(0));
    const bold = recordIdOf(base, "bold");
    const state = createState(DOC, EditorSelection.single(bold.fullRange.from + 3));

    const own = decorations(state).filter((item) => item.recordId === bold.id);
    expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(2);
    expect(own.filter((item) => item.role === "inline-marker-hidden")).toHaveLength(0);
  });

  it("T-14: OFF 且光标落在 marker 内部 ⇒ 可见（AC-2 独立子用例）", () => {
    const base = createState(DOC, EditorSelection.single(0));
    const bold = recordIdOf(base, "bold");
    const state = createState(DOC, EditorSelection.single(bold.fullRange.from + 1));

    const own = decorations(state).filter((item) => item.recordId === bold.id);
    expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(2);
  });

  it("T-15: OFF 但 marker 落在 composition guard 内 ⇒ 保持可见（IME 保护）", () => {
    const base = createState(DOC, EditorSelection.single(0));
    const bold = recordIdOf(base, "bold");
    const guarded = base.update({
      effects: startWysiwygCompositionGuardEffect.of([
        { from: bold.fullRange.from, to: bold.fullRange.to },
      ]),
    }).state;

    const own = decorations(guarded).filter((item) => item.recordId === bold.id);
    expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(2);
    expect(own.filter((item) => item.role === "inline-marker-hidden")).toHaveLength(0);
  });

  it("T-16a: 本地插件记录（非白名单 kind）即使 OFF 也未触及也必须常显", () => {
    const doc = localInlineMarkdown();
    const base = createState(doc, EditorSelection.single(0));
    const plugin = recordIdOf(base, "highlight");

    // 非空前置：先确认该记录真的产出了 2 个 marker;否则本用例会静默空转。
    expect(plugin.markerRanges).toHaveLength(2);

    const state = createState(doc, EditorSelection.single(1));
    const own = decorations(state).filter((item) => item.recordId === plugin.id);
    expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(2);
    expect(own.filter((item) => item.role === "inline-marker-hidden")).toHaveLength(0);
  });

  it("T-17: 嵌套 *** 不产生重叠折叠", () => {
    const doc = "Head\n\n***nested*** tail\n";
    const state = createState(doc, EditorSelection.single(1));
    const hidden = decorations(state).filter((item) => item.role === "inline-marker-hidden");

    // bold 与 italic 各 2 个 marker（解析实测互不重叠），共 4 段折叠区间。
    expect(hidden).toHaveLength(4);
    const sorted = hidden.toSorted((left, right) => left.from - right.from);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].from).toBeGreaterThanOrEqual(sorted[index - 1].to);
    }
  });

  it("T-18: 开关 ON ⇒ 四类 marker 全部可见（等价改造前）", () => {
    const state = createState(DOC, EditorSelection.single(1), true);
    const all = decorations(state);

    for (const kind of ["bold", "italic", "strikethrough", "inline-code"]) {
      const record = recordIdOf(state, kind as never);
      const own = all.filter((item) => item.recordId === record.id);
      expect(own.filter((item) => item.role === "inline-marker")).toHaveLength(2);
      expect(own.filter((item) => item.role === "inline-marker-hidden")).toHaveLength(0);
    }
  });
});
