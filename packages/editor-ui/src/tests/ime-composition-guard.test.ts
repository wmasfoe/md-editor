import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { findIntroducedHardbreakPositions } from "../utils/ime-composition-guard";

describe("IME composition guard", () => {
  it("finds hardbreaks introduced by the current transaction", () => {
    const { state, hardbreak } = createHardbreakState("abc");
    const transaction = state.tr.insert(4, hardbreak.create());
    const nextState = state.apply(transaction);

    expect(findIntroducedHardbreakPositions(state.doc, nextState.doc, [transaction])).toEqual([4]);
  });

  it("does not treat mapped existing hardbreaks as newly introduced", () => {
    const { state } = createHardbreakState("abc", true);
    const transaction = state.tr.insertText("x", 1);
    const nextState = state.apply(transaction);

    expect(findIntroducedHardbreakPositions(state.doc, nextState.doc, [transaction])).toEqual([]);
  });
});

function createHardbreakState(text: string, withHardbreak = false) {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      hardbreak: { inline: true, group: "inline", selectable: false }
    }
  });
  const hardbreak = schema.nodes.hardbreak;
  const paragraphContent = withHardbreak
    ? [schema.text(text), hardbreak.create()]
    : [schema.text(text)];

  return {
    hardbreak,
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, paragraphContent))
    })
  };
}
