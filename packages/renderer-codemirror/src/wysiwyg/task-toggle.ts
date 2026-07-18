import type { StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { SourceRange } from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";

export interface TaskMarkerTarget extends SourceRange {
  readonly recordId: string;
}

export const toggleSelectedTasks: StateCommand = ({ state, dispatch }) => {
  if (state.field(editorModeField) !== "wysiwyg") {
    return false;
  }
  const targets = state.selection.ranges.map((range) =>
    range.empty ? null : findExactTaskMarker(state, range.from, range.to),
  );
  if (targets.some((target) => target === null)) {
    return false;
  }
  const changes = targets.map((target) => ({
    from: target!.from,
    to: target!.to,
    insert: taskToggleText(state.sliceDoc(target!.from, target!.to)),
  }));
  dispatch(state.update({ changes, userEvent: "input.task-toggle" }));
  return true;
};

export function toggleTaskMarkerAt(view: EditorView, target: TaskMarkerTarget): boolean {
  const { state } = view;
  if (
    view.composing ||
    state.field(editorModeField) !== "wysiwyg" ||
    findExactTaskMarker(state, target.from, target.to)?.recordId !== target.recordId
  ) {
    return false;
  }
  view.dispatch({
    changes: {
      from: target.from,
      to: target.to,
      insert: taskToggleText(state.sliceDoc(target.from, target.to)),
    },
    userEvent: "input.task-toggle",
  });
  return true;
}

function findExactTaskMarker(
  state: EditorView["state"],
  from: number,
  to: number,
): TaskMarkerTarget | null {
  for (const record of state.field(markdownRangeIndexField).overlapping(from, to)) {
    if (record.kind !== "task") {
      continue;
    }
    const marker = record.markerRanges.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (marker) {
      return { recordId: record.id, from: marker.from, to: marker.to };
    }
  }
  return null;
}

function taskToggleText(marker: string): string {
  return marker === "[ ]" ? "[x]" : "[ ]";
}
