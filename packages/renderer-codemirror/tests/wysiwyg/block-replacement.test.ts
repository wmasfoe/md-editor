import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  applyBlockCategory,
  buildWholeLineBlockReplacement,
  trailingLineBreakEnd,
  WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE,
} from "../../src/wysiwyg/blocks/block-replacement.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";

/**
 * 契约测试：整行块级替换装饰的**不对称 Inclusivity** 是 CM6 幽灵空行/吞行问题的唯一解法。
 * 具体表现为 E2E 的空行数量断言；此处锁死装饰参数层。
 */

class ProbeWidget extends WidgetType {
  // toDOM 不在单测中调用（Node 环境无 DOM）；契约只关心装饰参数。
  override toDOM(): HTMLElement {
    throw new Error("ProbeWidget 不应被挂载到 DOM");
  }
  override eq(other: ProbeWidget): boolean {
    return other instanceof ProbeWidget;
  }
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures([
        "headings",
        "blocks",
        "tables",
        "html",
        "mdx",
        "default-atoms",
        "thematic-breaks",
      ]),
      wysiwygProjectionField,
    ],
  });
}

describe("whole-line block replacement contract", () => {
  it("uses asymmetric inclusivity and covers the trailing line break by default", () => {
    const doc = "Before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n";
    const state = createState(doc);
    const table = state.field(markdownRangeIndexField).byKind("table")[0];
    expect(table).toBeDefined();

    const decorations = buildWholeLineBlockReplacement({
      record: table,
      state,
      widget: new ProbeWidget(),
      role: "probe-widget",
    });

    expect(decorations).toHaveLength(1);
    const spec = decorations[0].value.spec as Record<string, unknown>;
    expect(spec.block).toBe(true);
    expect(spec.inclusiveStart).toBe(true);
    expect(spec.inclusiveEnd).toBe(false);
    expect(spec.wysiwygRole).toBe("probe-widget");

    // 起点必须落在整行行首，否则 CM6 仍可能合成幽灵空行
    expect(state.doc.lineAt(table.fullRange.from).from).toBe(table.fullRange.from);
    // 覆盖整行并包含末尾换行符，但 inclusiveEnd: false 保证不吞并其后的换行
    expect(decorations[0].to).toBe(table.fullRange.to + 1);
  });

  it("keeps the record range when the trailing line break must not be covered", () => {
    const doc = "[ref]: https://example.com\n\nafter\n";
    const state = createState(doc);
    const definition = state.field(markdownRangeIndexField).byKind("reference-definition")[0];
    expect(definition).toBeDefined();

    const decorations = buildWholeLineBlockReplacement({
      record: definition,
      state,
      widget: new ProbeWidget(),
      role: "probe-widget",
      includeTrailingLineBreak: false,
    });

    expect(decorations[0].to).toBe(definition.fullRange.to);
    expect(state.doc.lineAt(definition.fullRange.from).from).toBe(definition.fullRange.from);
  });

  it("reports the trailing line break end for records at the document tail", () => {
    const state = createState("| a |\n| --- |\n| 1 |");
    const table = state.field(markdownRangeIndexField).byKind("table")[0];
    expect(trailingLineBreakEnd(table, state)).toBe(state.doc.length);

    const withBreak = createState("| a |\n| --- |\n| 1 |\n");
    const tableWithBreak = withBreak.field(markdownRangeIndexField).byKind("table")[0];
    expect(trailingLineBreakEnd(tableWithBreak, withBreak)).toBe(tableWithBreak.fullRange.to + 1);
  });

  it("declares the visual category as a DOM attribute for CSS rules", () => {
    const attributes = new Map<string, string>();
    const element = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLElement;

    applyBlockCategory(element, "symbol");
    expect(attributes.get(WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE)).toBe("symbol");

    applyBlockCategory(element, "content");
    expect(attributes.get(WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE)).toBe("content");
  });
});
