// @vitest-environment jsdom
import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import { describe, expect, it, vi } from "vitest";
import { moveAtomVertically } from "../../src/wysiwyg/blocks/atom-selection.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import {
  markdownRangeIndexField,
  syntaxPluginRegistryFacet,
} from "../../src/markdown/range-index.ts";
import { SyntaxPluginRegistry } from "../../src/plugins/syntax-registry.ts";
import { editorModeField, setEditorModeEffect } from "../../src/mode.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";
import { wysiwygProjectionField } from "../../src/wysiwyg/state/projection-field.ts";
import {
  materializeVirtualTrailingLine,
  moveDownToVirtualTrailingLine,
  needsVirtualTrailingLine,
} from "../../src/wysiwyg/editing/virtual-trailing-line.ts";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

class DiagramWidget extends WidgetType {
  toDOM() {
    const element = document.createElement("div");
    element.textContent = "Diagram";
    return element;
  }
}
// The host contract is tested without importing a concrete plugin or calling its network loader.
const plugin: MarkdownSyntaxPlugin = {
  id: "test.diagram",
  name: "Diagram",
  nodePolicies: {
    FencedCode: {
      kind: "raw-fallback",
      renderPolicy: "directive-panel",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      priority: 30,
      markerNodeNames: [],
      contentStrategy: "full",
    },
  },
  buildDecorations(record, _state, context) {
    return [
      context?.active
        ? Decoration.mark({ class: "diagram-source" }).range(
            record.fullRange.from,
            record.fullRange.to,
          )
        : Decoration.replace({
            block: true,
            widget: new DiagramWidget(),
            wysiwygRole: "diagram",
          }).range(record.fullRange.from, record.fullRange.to),
    ];
  },
};

function mount(doc: string, withPlugin = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const registry = new SyntaxPluginRegistry(withPlugin ? [plugin] : []);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        history(),
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        editorModeField,
        syntaxPluginRegistryFacet.of(registry),
        markdownRangeIndexField,
        createWysiwygProjectionExtensions(["blocks", "html", "tables", "thematic-breaks"]),
      ],
    }),
  });
  return {
    view,
    destroy() {
      view.destroy();
      parent.remove();
    },
  };
}

const diagram = "```mermaid\ngraph TD; A-->B\n```";
describe("terminal plugin and container blocks", () => {
  it.each(["forward", "backward"] as const)(
    "reveals plugin source when %s visual movement skips over its block widget",
    (direction) => {
      const doc = "Before\n\n" + diagram + "\n\nAfter";
      const { view, destroy } = mount(doc, true);
      try {
        const forward = direction === "forward";
        view.dispatch({ selection: EditorSelection.cursor(forward ? 6 : doc.length) });
        vi.spyOn(view, "moveVertically").mockReturnValue(
          EditorSelection.cursor(forward ? doc.length : 0),
        );
        expect(moveAtomVertically(view, direction)).toBe(true);
        expect(view.state.selection.main.head).toBe(
          forward ? doc.indexOf("```") + 1 : doc.lastIndexOf("```") + 2,
        );
        expect(view.state.field(wysiwygProjectionField).activeSyntaxIds).toHaveLength(1);
        expect(view.state.doc.toString()).toBe(doc);
        // Once source is revealed, subsequent movement returns to CM6.
        expect(moveAtomVertically(view, direction)).toBe(false);
      } finally {
        destroy();
      }
    },
  );

  it.each(
    (
      [
        ["plugin", diagram, true],
        ["quote", "> quoted text", false],
        ["list", "- item", false],
        ["nested quote HTML", "> <div>Block</div>", false],
        ["nested list diagram", "- item\n\n  " + diagram.replaceAll("\n", "\n  "), true],
        ["nested quote table", "> | A | B |\n> | - | - |\n> | x | y |", false],
      ] as const
    ).flatMap(([name, doc, withPlugin]) => [
      [name, doc, withPlugin] as const,
      [name + " with trailing newline", doc + "\n", withPlugin] as const,
    ]),
  )(
    "exits %s without changing bytes until typing, then undoes in one step",
    (_name, doc, withPlugin) => {
      const { view, destroy } = mount(doc, withPlugin);
      try {
        expect(needsVirtualTrailingLine(view.state)).toBe(true);
        expect(view.state.doc.toString()).toBe(doc);
        expect(moveDownToVirtualTrailingLine(view)).toBe(true);
        expect(materializeVirtualTrailingLine(view, "Tail", "input.type")).toBe(true);
        expect(view.state.doc.toString()).toBe(doc + (doc.endsWith("\n") ? "\n" : "\n\n") + "Tail");
        const tail = syntaxTree(view.state).resolveInner(view.state.doc.length - 1);
        expect(tail.name).toBe("Paragraph");
        expect(tail.parent?.name).toBe("Document");
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(doc);
      } finally {
        destroy();
      }
    },
  );

  it("recomputes the source projection when ArrowDown only changes the virtual-line effect", () => {
    const { view, destroy } = mount("<div>Block</div>");
    try {
      expect(view.state.field(wysiwygProjectionField).activeSyntaxIds.length).toBeGreaterThan(0);
      expect(moveDownToVirtualTrailingLine(view)).toBe(true);
      expect(view.state.field(wysiwygProjectionField).activeSyntaxIds).toEqual([]);
      expect(view.state.doc.toString()).toBe("<div>Block</div>");
    } finally {
      destroy();
    }
  });

  it("applies the core whole-line replacement contract to plugin widgets", () => {
    const { view, destroy } = mount(diagram + "\n", true);
    try {
      view.dispatch({ selection: EditorSelection.cursor(0) });
      moveDownToVirtualTrailingLine(view);
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      const projection = view.state.field(wysiwygProjectionField);
      const ranges: { from: number; to: number; spec: Decoration["spec"] }[] = [];
      projection.layoutDecorations.between(0, view.state.doc.length, (from, to, value) => {
        if (value.spec.wysiwygRole === "diagram") ranges.push({ from, to, spec: value.spec });
      });
      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.to).toBe(view.state.doc.length);
      expect(ranges[0]?.spec.inclusiveStart).toBe(true);
      expect(ranges[0]?.spec.inclusiveEnd).toBe(false);
    } finally {
      destroy();
    }
  });

  it.each([diagram, "> quoted text", "- item"])(
    "uses real blank lines and native source-mode lines (%s)",
    (doc) => {
      const { view, destroy } = mount(doc + "\n\n", true);
      try {
        expect(needsVirtualTrailingLine(view.state)).toBe(false);
        view.dispatch({ effects: setEditorModeEffect.of("source") });
        expect(needsVirtualTrailingLine(view.state)).toBe(false);
      } finally {
        destroy();
      }
    },
  );
});
