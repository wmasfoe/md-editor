/**
 * @file mode.ts
 * @description CodeMirror 编辑器模式（WYSIWYG 所见即所得 vs Source 纯源码）状态控制字段与 Facet。
 */

import type { EditorMode } from "@md-editor/editor-core";
import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * 初始配置的编辑器模式 Facet。
 */
const configuredMode = Facet.define<EditorMode, EditorMode>({
  combine(values) {
    return values.at(-1) ?? "wysiwyg";
  },
});

/**
 * 切换编辑器模式（wysiwyg / source）的 StateEffect。
 */
export const setEditorModeEffect = StateEffect.define<EditorMode>();

/**
 * 维护当前编辑器运行模式的 StateField。
 */
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
