import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Transaction } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../markdown/range-index.ts";

class MarkdownParseProgress {
  readonly #view: EditorView;
  #refreshScheduled = false;
  #destroyed = false;

  constructor(view: EditorView) {
    this.#view = view;
    this.#scheduleIfAdvanced();
  }

  update(_update: ViewUpdate): void {
    this.#scheduleIfAdvanced();
  }

  destroy(): void {
    this.#destroyed = true;
  }

  #scheduleIfAdvanced(): void {
    if (this.#refreshScheduled || !parseCoverageAdvanced(this.#view)) {
      return;
    }
    this.#refreshScheduled = true;
    queueMicrotask(() => {
      this.#refreshScheduled = false;
      if (this.#destroyed || !parseCoverageAdvanced(this.#view)) {
        return;
      }
      this.#view.dispatch({
        effects: refreshMarkdownParseCoverageEffect.of(null),
        annotations: Transaction.addToHistory.of(false),
      });
    });
  }
}

export const markdownParseProgressPlugin = ViewPlugin.fromClass(MarkdownParseProgress);

function parseCoverageAdvanced(view: EditorView): boolean {
  const index = view.state.field(markdownRangeIndexField);
  const tree = syntaxTree(view.state);
  const currentTo = Math.min(tree.length, view.state.doc.length);
  const currentComplete = syntaxTreeAvailable(view.state, view.state.doc.length);
  return currentTo > index.coverage.to || (currentComplete && !index.coverage.complete);
}
