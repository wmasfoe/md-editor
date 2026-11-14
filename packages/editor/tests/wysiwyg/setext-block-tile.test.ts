// @vitest-environment jsdom

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { selectWysiwygAtom } from "../../src/wysiwyg/blocks/atom-selection.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";
import { authorizeWysiwygProtectedChange } from "../../src/wysiwyg/state/change-authorization.ts";
import { wysiwygProjectionField } from "../../src/wysiwyg/state/projection-field.ts";

/**
 * 多行 setext（`[]\n[]\n---`）被整段换成一个 block replace。IME composition
 * 事务只 map 这段装饰、不重建 widget。`@codemirror/view` 6.43.1 在「变更落在
 * 仍打开的块 widget 内部」时会把 tile 树写短，随后：
 *
 * - `DocTile.resolveBlock` 抛 `No tile at position 512`（INKPOINT-4 / INKPOINT-E）
 * - `TilePointer.advance` 对空的 parent 解构失败（INKPOINT-B / INKPOINT-C / INKPOINT-D）
 *
 * 6.43.6 起修复了这次增量更新。这里锁住真实 setext composition，以及不经过
 * 投影层的纯块替换，避免版本回退后再把 tile 树写短。
 */

const SETEXT_DOC = `${"x".repeat(500)}\n\n[]\n[]\n---\n\nnext\n`;

interface DocViewTile {
  readonly length: number;
  resolveBlock(pos: number, side: number): unknown;
}

interface DocViewProbe {
  tile: DocViewTile;
  lineHasWidget(pos: number): boolean;
}

/**
 * 有意探测 CodeMirror 的私有实现，不是公开 API：`view.docView.tile.resolveBlock`
 * 与 `view.docView.lineHasWidget`。这里失败时，先确认这两个内部方法有没有被改名，
 * 再判断是不是 tile 树回归。
 */
function docViewOf(view: EditorView): DocViewProbe {
  const docView = (view as unknown as { docView?: Partial<DocViewProbe> }).docView;
  if (typeof docView?.tile?.resolveBlock !== "function") {
    throw new Error(
      "CodeMirror internal API docView.tile.resolveBlock not found — internals changed",
    );
  }
  if (typeof docView.lineHasWidget !== "function") {
    throw new Error("CodeMirror internal API docView.lineHasWidget not found — internals changed");
  }
  return docView as DocViewProbe;
}

function expectTileCoversDocument(view: EditorView): void {
  const docView = docViewOf(view);
  expect(docView.tile.length).toBe(view.state.doc.length);
  for (let pos = 0; pos <= view.state.doc.length; pos += 1) {
    expect(() => docView.tile.resolveBlock(pos, 1)).not.toThrow();
    expect(() => docView.lineHasWidget(pos)).not.toThrow();
  }
}

function mountEditor(doc: string): { view: EditorView; parent: HTMLDivElement } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return {
    parent,
    view: new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          EditorView.lineWrapping,
          markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
          editorModeField,
          markdownRangeIndexField,
          createWysiwygProjectionExtensions([
            "headings",
            "default-atoms",
            "blocks",
            "thematic-breaks",
            "links",
          ]),
        ],
      }),
    }),
  };
}

function blockWidgetRange(view: EditorView): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  view.state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.wysiwygRole === "default-atom-widget" && value.spec.block === true) {
        found = { from, to };
      }
    });
  return found;
}

class ProbeWidget extends WidgetType {
  eq(other: ProbeWidget): boolean {
    return other instanceof ProbeWidget;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.textContent = "setext";
    return element;
  }
}

describe("multiline setext block widget tile tree", () => {
  it("keeps every document position tiled after a composition edit and a second click", () => {
    const { view, parent } = mountEditor(SETEXT_DOC);
    try {
      const initial = blockWidgetRange(view);
      expect(initial).toEqual({ from: 502, to: 512 });
      expect(view.state.doc.lineAt(initial!.to - 1).number).toBeGreaterThan(
        view.state.doc.lineAt(initial!.from).number,
      );
      expectTileCoversDocument(view);

      const record = view.state.field(markdownRangeIndexField).byKind("heading-setext")[0];
      expect(
        record?.contentRange &&
          view.state.sliceDoc(record.contentRange.from, record.contentRange.to),
      ).toBe("[]\n[]");
      view.dispatch({
        changes: {
          from: record.contentRange!.from + 1,
          to: record.contentRange!.from + 1,
          insert: "q",
        },
        annotations: authorizeWysiwygProtectedChange.of(true),
        userEvent: "input.type.compose",
      });
      expectTileCoversDocument(view);
      expect(docViewOf(view).lineHasWidget(512)).toBe(true);

      const updated = view.state.field(markdownRangeIndexField).byKind("heading-setext")[0];
      expect(updated).toBeTruthy();
      expect(() => selectWysiwygAtom(view, updated.id)).not.toThrow();
      expect(() => selectWysiwygAtom(view, updated.id)).not.toThrow();
      expectTileCoversDocument(view);
      const selection = view.state.selection.main;
      expect(view.state.doc.lineAt(selection.from).to).toBeLessThan(selection.to);
      expect(() => docViewOf(view).lineHasWidget(selection.to)).not.toThrow();
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("keeps the tile tree aligned when a mapped block replace grows around an interior edit", () => {
    const widget = new ProbeWidget();
    const from = SETEXT_DOC.indexOf("[]");
    // 含 setext 下划线后的那个换行，与真实 default-atom 装饰的终点一致（文档偏移 512）。
    const to = SETEXT_DOC.indexOf("\n\nnext") + 1;
    const decorations = StateField.define({
      create() {
        return Decoration.set([
          Decoration.replace({
            widget,
            block: true,
            inclusiveStart: true,
            inclusiveEnd: false,
          }).range(from, to),
        ]);
      },
      update(value, transaction) {
        return value.map(transaction.changes);
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: SETEXT_DOC,
        extensions: [EditorView.lineWrapping, decorations],
      }),
    });
    try {
      expect(to).toBe(512);
      expectTileCoversDocument(view);
      view.dispatch({ changes: { from: from + 3, to: from + 3, insert: "q" } });
      expectTileCoversDocument(view);
      expect(() => docViewOf(view).lineHasWidget(512)).not.toThrow();
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
