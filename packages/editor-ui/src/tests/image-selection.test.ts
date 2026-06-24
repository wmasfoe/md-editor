import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  AllSelection,
  EditorState,
  NodeSelection,
  TextSelection
} from "@milkdown/kit/prose/state";
import {
  findImageNodePositionForDom,
  hasProseMirrorSeparatorImageClass,
  imageSelectionPluginKey,
  isImageNodeSelection,
  shouldClearNativeImageSelection
} from "../utils/image-selection";

describe("image selection", () => {
  it("uses a stable plugin key for image node selection handling", () => {
    expect(imageSelectionPluginKey).toBeTruthy();
  });

  it("recognizes ProseMirror separator images as internal DOM, not editor images", () => {
    expect(hasProseMirrorSeparatorImageClass("ProseMirror-separator")).toBe(true);
    expect(hasProseMirrorSeparatorImageClass("foo ProseMirror-separator bar")).toBe(true);
    expect(hasProseMirrorSeparatorImageClass("md-editor-selected-image")).toBe(false);
  });

  it("maps a clicked image DOM node back to the whole image node", () => {
    const schema = createImageTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("before "),
        schema.nodes.image.create({ src: "assets/diagram.png", alt: "Diagram", title: "" }),
        schema.text(" after")
      ])
    ]);
    const imageDom = createFakeDomNode();
    const imagePosition = 8;

    expect(
      findImageNodePositionForDom(
        doc,
        (position) => (position === imagePosition ? imageDom : null),
        imageDom
      )
    ).toBe(imagePosition);
  });

  it("identifies only image NodeSelection as image selection guard state", () => {
    const schema = createImageTestSchema();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("before "),
        schema.nodes.image.create({ src: "assets/diagram.png", alt: "Diagram", title: "" }),
        schema.text(" after")
      ])
    ]);

    expect(isImageNodeSelection(NodeSelection.create(doc, 8))).toBe(true);
    expect(isImageNodeSelection(TextSelection.create(doc, 1))).toBe(false);
  });

  it("allows a cross-block text selection to replace image node selection", () => {
    const { doc, imagePosition, textRanges } = createSelectionTransitionDocument();
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, imagePosition)
    });
    const selection = TextSelection.create(
      doc,
      textRanges[0].from,
      textRanges.at(-1)?.to
    );
    const nextState = state.apply(state.tr.setSelection(selection));

    expect(nextState.selection).toBeInstanceOf(TextSelection);
    expect(nextState.selection.empty).toBe(false);
    expect(nextState.selection.visible).toBe(true);
    expect(isImageNodeSelection(nextState.selection)).toBe(false);
  });

  it("allows full-document selection to replace image node selection", () => {
    const { doc, imagePosition } = createSelectionTransitionDocument();
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, imagePosition)
    });
    const nextState = state.apply(state.tr.setSelection(new AllSelection(doc)));

    expect(nextState.selection).toBeInstanceOf(AllSelection);
    expect(nextState.selection.from).toBe(0);
    expect(nextState.selection.to).toBe(doc.content.size);
    expect(nextState.selection.visible).toBe(true);
    expect(isImageNodeSelection(nextState.selection)).toBe(false);
  });

  it("clears delayed native selection only while the transient image guard is armed", () => {
    const { doc, imagePosition, textRanges } = createSelectionTransitionDocument();
    const imageSelection = NodeSelection.create(doc, imagePosition);
    const textSelection = TextSelection.create(
      doc,
      textRanges[0].from,
      textRanges.at(-1)?.to
    );

    expect(shouldClearNativeImageSelection(true, imageSelection, true)).toBe(true);
    expect(shouldClearNativeImageSelection(false, imageSelection, true)).toBe(false);
    expect(shouldClearNativeImageSelection(true, textSelection, true)).toBe(false);
    expect(shouldClearNativeImageSelection(true, imageSelection, false)).toBe(false);
  });
});

export function createImageTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      blockquote: { content: "block+", group: "block" },
      text: { group: "inline" },
      image: {
        inline: true,
        group: "inline",
        atom: true,
        selectable: true,
        attrs: {
          src: { default: "" },
          alt: { default: "" },
          title: { default: "" }
        }
      }
    }
  });
}

function createSelectionTransitionDocument() {
  const schema = createImageTestSchema();
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("plain text "),
      schema.nodes.image.create({ src: "assets/diagram.png", alt: "Diagram", title: "" })
    ]),
    schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("quoted text"))
    )
  ]);
  let imagePosition = -1;
  const textRanges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, position) => {
    if (node.type.name === "image") {
      imagePosition = position;
    } else if (node.isText) {
      textRanges.push({ from: position, to: position + node.nodeSize });
    }
  });

  return { doc, imagePosition, textRanges };
}

function createFakeDomNode(): Node {
  const node = {
    contains: (target: Node) => target === node
  };
  return node as Node;
}
