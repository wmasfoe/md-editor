import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { editorModeField } from "../mode.ts";
import { buildInlineStyleDecorations } from "./inline-heading.ts";
import { hasWysiwygProjectionFeature } from "./projection-state.ts";

class VisibleMarkdownMarks {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildVisibleMarkdownMarks(view);
  }

  update(update: ViewUpdate): void {
    const modeChanged =
      update.startState.field(editorModeField) !== update.state.field(editorModeField);
    const indexChanged =
      update.startState.field(markdownRangeIndexField) !==
      update.state.field(markdownRangeIndexField);
    if (update.docChanged || update.viewportChanged || modeChanged || indexChanged) {
      this.decorations = buildVisibleMarkdownMarks(update.view);
    }
  }
}

export const visibleMarkdownMarksPlugin = ViewPlugin.fromClass(VisibleMarkdownMarks, {
  decorations: (plugin) => plugin.decorations,
});

export function buildVisibleMarkdownMarks(view: EditorView): DecorationSet {
  const state = view.state;
  getWysiwygDiagnostics(state)?.recordVisibleMarkBuild();
  if (
    state.field(editorModeField) === "source" ||
    !hasWysiwygProjectionFeature(state, "inline-styles")
  ) {
    return Decoration.none;
  }

  const index = state.field(markdownRangeIndexField);
  const seen = new Set<string>();
  const ranges = view.visibleRanges.flatMap((visibleRange) =>
    index
      .overlapping(visibleRange.from, visibleRange.to)
      .filter((record) => {
        if (seen.has(record.id)) {
          return false;
        }
        seen.add(record.id);
        return record.renderPolicy === "inline-visible-markers" && record.contentRange !== null;
      })
      .flatMap((record) => buildInlineStyleDecorations(record)),
  );
  return Decoration.set(ranges, true);
}
