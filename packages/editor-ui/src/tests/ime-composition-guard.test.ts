import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import {
  findIntroducedHardbreakPositions,
  forceCompositionDomFlush,
  refreshCompositionDom,
  shouldRestoreCancelledCompositionSelection,
} from "../utils/ime-composition-guard";

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

  it("flushes pending composition DOM cleanup after composition settles", () => {
    const calls: string[] = [];

    expect(
      forceCompositionDomFlush({
        domObserver: {
          forceFlush: () => calls.push("forceFlush"),
          flush: () => calls.push("flush"),
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(["forceFlush", "flush"]);
  });

  it("refreshes composition DOM without changing the document or history", () => {
    const { state } = createHardbreakState("abc");
    let dispatched = state.tr;

    refreshCompositionDom({
      state,
      dispatch: (transaction) => {
        dispatched = transaction;
      },
    });

    expect(dispatched.docChanged).toBe(false);
    expect(dispatched.getMeta("addToHistory")).toBe(false);
  });

  it("restores the composition start selection when cancelled pinyin leaves the document unchanged", () => {
    const { state } = createHardbreakState("abc");
    const startSelection = TextSelection.create(state.doc, 2);
    const driftedSelection = TextSelection.create(state.doc, 4);

    expect(
      shouldRestoreCancelledCompositionSelection(
        state.doc,
        state.doc,
        startSelection,
        driftedSelection,
      ),
    ).toBe(true);
  });

  it("does not restore the start selection after committed composition changes the document", () => {
    const { state } = createHardbreakState("abc");
    const startSelection = TextSelection.create(state.doc, 2);
    const transaction = state.tr.insertText("中", 2);
    const nextState = state.apply(transaction);

    expect(
      shouldRestoreCancelledCompositionSelection(
        state.doc,
        nextState.doc,
        startSelection,
        nextState.selection,
      ),
    ).toBe(false);
  });
});

function createHardbreakState(text: string, withHardbreak = false) {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      hardbreak: { inline: true, group: "inline", selectable: false },
    },
  });
  const hardbreak = schema.nodes.hardbreak;
  const paragraphContent = withHardbreak
    ? [schema.text(text), hardbreak.create()]
    : [schema.text(text)];

  return {
    hardbreak,
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, paragraphContent)),
    }),
  };
}
