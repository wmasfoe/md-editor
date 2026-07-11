import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  createHorizontalRuleSelectionProsePlugin,
  horizontalRuleSelectionPluginKey,
  isHorizontalRuleNodeSelection,
} from "../utils/horizontal-rule-selection";

describe("horizontal rule selection", () => {
  it("uses a stable plugin key", () => {
    expect(horizontalRuleSelectionPluginKey).toBeTruthy();
  });

  it("selects the whole hr node on a direct click", () => {
    const { state, hrPosition } = createHorizontalRuleState();
    const view = createMutableEditorView(state);
    const event = createMouseEventLike();
    const plugin = createHorizontalRuleSelectionProsePlugin();
    const hr = state.doc.nodeAt(hrPosition)!;

    expect(
      plugin.props.handleClickOn?.call(plugin, view, hrPosition, hr, hrPosition, event, true),
    ).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(hrPosition);
    expect(isHorizontalRuleNodeSelection(view.state.selection)).toBe(true);
  });

  it("leaves indirect and non-hr clicks to ProseMirror", () => {
    const { state, hrPosition } = createHorizontalRuleState();
    const view = {
      state,
      dispatch: () => {
        throw new Error("horizontal rule selection must not dispatch for unrelated clicks");
      },
    } as unknown as EditorView;
    const plugin = createHorizontalRuleSelectionProsePlugin();
    const hr = state.doc.nodeAt(hrPosition)!;
    const paragraph = state.doc.firstChild!;

    expect(
      plugin.props.handleClickOn?.call(
        plugin,
        view,
        hrPosition,
        hr,
        hrPosition,
        createMouseEventLike(),
        false,
      ),
    ).toBe(false);
    expect(
      plugin.props.handleClickOn?.call(plugin, view, 0, paragraph, 0, createMouseEventLike(), true),
    ).toBe(false);
  });

  it.each(["Backspace", "Delete"])("deletes a selected hr with %s", (key) => {
    const { state, hrPosition } = createHorizontalRuleState();
    const selectedState = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, hrPosition)),
    );
    const view = createMutableEditorView(selectedState);
    const event = createKeyboardEventLike(key);
    const plugin = createHorizontalRuleSelectionProsePlugin();

    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.textContent).toBe("beforeafter");
  });

  it("does not intercept text or full-document selections", () => {
    const { state } = createHorizontalRuleState();
    const plugin = createHorizontalRuleSelectionProsePlugin();
    const textState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
    const allState = state.apply(state.tr.setSelection(new AllSelection(state.doc)));

    for (const selectionState of [textState, allState]) {
      const view = {
        state: selectionState,
        dispatch: () => {
          throw new Error("horizontal rule selection must preserve non-node selections");
        },
      } as unknown as EditorView;
      const event = createKeyboardEventLike("Delete");

      expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });
});

function createHorizontalRuleState() {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      hr: { group: "block", selectable: true },
      text: {},
    },
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("before")),
    schema.nodes.hr.create(),
    schema.nodes.paragraph.create(null, schema.text("after")),
  ]);
  let hrPosition = -1;
  doc.descendants((node, position) => {
    if (node.type.name === "hr") {
      hrPosition = position;
      return false;
    }
  });

  return { state: EditorState.create({ doc }), hrPosition };
}

function createMutableEditorView(initialState: EditorState): EditorView {
  let currentState = initialState;
  return {
    get state() {
      return currentState;
    },
    dispatch(transaction: Parameters<EditorView["dispatch"]>[0]) {
      currentState = currentState.apply(transaction);
    },
    focus() {},
  } as unknown as EditorView;
}

function createMouseEventLike() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as MouseEvent & { defaultPrevented: boolean };
}

function createKeyboardEventLike(key: string) {
  return {
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as KeyboardEvent & { defaultPrevented: boolean };
}
