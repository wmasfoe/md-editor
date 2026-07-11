import { $prose } from "@milkdown/kit/utils";
import { NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { NodeView } from "@milkdown/kit/prose/view";

export const horizontalRuleSelectionPluginKey = new PluginKey(
  "md-editor-horizontal-rule-selection",
);

export const horizontalRuleSelectionPlugin = $prose(createHorizontalRuleSelectionProsePlugin);

export function createHorizontalRuleSelectionProsePlugin(): Plugin {
  return new Plugin({
    key: horizontalRuleSelectionPluginKey,
    props: {
      nodeViews: {
        hr: (_, view) => createHorizontalRuleNodeView(view.dom.ownerDocument),
      },
      handleClickOn(view, _, node, nodePosition, event, direct) {
        if (!direct || node.type.name !== "hr") {
          return false;
        }

        event.preventDefault();
        view.dispatch(
          view.state.tr
            .setSelection(NodeSelection.create(view.state.doc, nodePosition))
            .scrollIntoView(),
        );
        view.focus();
        return true;
      },
      handleKeyDown(view, event) {
        if (!(event.key === "Backspace" || event.key === "Delete")) {
          return false;
        }
        if (!isHorizontalRuleNodeSelection(view.state.selection)) {
          return false;
        }

        event.preventDefault();
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
        return true;
      },
    },
  });
}

export function isHorizontalRuleNodeSelection(selection: unknown): boolean {
  return selection instanceof NodeSelection && selection.node.type.name === "hr";
}

function createHorizontalRuleNodeView(ownerDocument: Document): NodeView {
  const surface = ownerDocument.createElement("div");
  surface.className = "md-horizontal-rule";
  surface.contentEditable = "false";
  surface.setAttribute("role", "separator");
  surface.setAttribute("aria-orientation", "horizontal");

  const line = ownerDocument.createElement("span");
  line.className = "md-horizontal-rule__line";
  line.setAttribute("aria-hidden", "true");
  surface.append(line);

  return { dom: surface };
}
