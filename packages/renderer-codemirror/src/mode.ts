import type { EditorMode } from "@md-editor/editor-core";
import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const configuredMode = Facet.define<EditorMode, EditorMode>({
  combine(values) {
    return values.at(-1) ?? "wysiwyg";
  },
});

export const setEditorModeEffect = StateEffect.define<EditorMode>();

export const editorModeField = StateField.define<EditorMode>({
  create(state) {
    return state.facet(configuredMode);
  },
  update(previousMode, transaction) {
    let nextMode = previousMode;
    for (const effect of transaction.effects) {
      if (effect.is(setEditorModeEffect)) {
        nextMode = effect.value;
      }
    }
    return nextMode;
  },
});

export function createModeExtensions(mode: EditorMode): Extension {
  return [
    configuredMode.of(mode),
    EditorView.editorAttributes.of({
      class: `cm-md-editor cm-md-editor--${mode}`,
      "data-editor-mode": mode,
    }),
  ];
}
