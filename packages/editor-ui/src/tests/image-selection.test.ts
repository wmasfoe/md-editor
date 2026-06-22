import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import {
  findImageNodePositionForDom,
  imageSelectionPluginKey,
  isImageNodeSelection
} from "../utils/image-selection";

describe("image selection", () => {
  it("uses a stable plugin key for image node selection handling", () => {
    expect(imageSelectionPluginKey).toBeTruthy();
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
});

export function createImageTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
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

function createFakeDomNode(): Node {
  const node = {
    contains: (target: Node) => target === node
  };
  return node as Node;
}
