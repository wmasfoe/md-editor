import { $prose } from "@milkdown/kit/utils";
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

export const imageSelectionPluginKey = new PluginKey("md-editor-image-selection");

export const imageSelectionPlugin = $prose(
  () =>
    new Plugin({
      key: imageSelectionPluginKey,
      props: {
        handleClickOn(view, position, node, nodePosition, event) {
          if (node.type.name !== "image") {
            clearStaleSelectedImageDom(view);
            return false;
          }

          event.preventDefault();
          event.stopPropagation();
          selectImageNode(view, nodePosition);
          return true;
        },
        handleKeyDown(view, event) {
          if (!(event.key === "Backspace" || event.key === "Delete")) {
            return false;
          }

          const selection = view.state.selection;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
            return false;
          }

          event.preventDefault();
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return true;
        }
      },
      view(view) {
        return {
          update(nextView) {
            const selection = nextView.state.selection;
            if (selection instanceof NodeSelection && selection.node.type.name === "image") {
              markSelectedImageDom(nextView, selection.from);
            } else {
              clearStaleSelectedImageDom(nextView);
            }
          }
        };
      }
    })
);

export function selectImageNode(view: EditorView, position: number): void {
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .scrollIntoView()
  );
  view.focus();
  markSelectedImageDom(view, position);
}

function markSelectedImageDom(view: EditorView, position: number): void {
  clearStaleSelectedImageDom(view);
  const node = view.nodeDOM(position);
  if (node instanceof HTMLElement) {
    node.classList.add("md-editor-selected-image");
  }
}

function clearStaleSelectedImageDom(view: EditorView): void {
  view.dom
    .querySelectorAll(".md-editor-selected-image")
    .forEach((node) => node.classList.remove("md-editor-selected-image"));
}
