import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { Prec, type EditorState, type StateCommand } from "@codemirror/state";
import { keymap, type Command } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import {
  clearSelectedAtoms,
  deleteSelectedAtomBackward,
  deleteSelectedAtomForward,
  moveAtomVertically,
  selectAtomBackward,
  selectAtomForward,
} from "./atom-selection.ts";
import { wysiwygProjectionField } from "./projection-state.ts";
import { toggleSelectedTasks as toggleSelectedTasksBase } from "./task-toggle.ts";

export { toggleTaskMarkerAt } from "./task-toggle.ts";

export const continueMarkdownMarkup: StateCommand = guarded(insertNewlineContinueMarkup);
export const toggleSelectedTasks: StateCommand = guarded(toggleSelectedTasksBase);

export function createMarkdownStructuredCommandExtensions() {
  return Prec.highest(
    keymap.of([
      { key: "Enter", run: viewCommand(continueMarkdownMarkup) },
      { key: "Backspace", run: viewCommand(deleteMarkdownMarkupBackward) },
      { key: "Delete", run: viewCommand(deleteMarkdownAtomForward) },
      { key: "ArrowLeft", run: viewCommand(selectMarkdownAtomBackward) },
      { key: "ArrowRight", run: viewCommand(selectMarkdownAtomForward) },
      { key: "ArrowUp", run: moveMarkdownAtomUp },
      { key: "ArrowDown", run: moveMarkdownAtomDown },
      { key: "Escape", run: viewCommand(clearMarkdownAtomSelection) },
      { key: "Tab", run: viewCommand(indentMarkdownList) },
      { key: "Shift-Tab", run: viewCommand(outdentMarkdownList) },
      { key: "Space", run: viewCommand(toggleSelectedTasks) },
    ]),
  );
}

function guarded(command: StateCommand): StateCommand {
  return (target) => (canRunStructuredCommand(target.state) ? command(target) : false);
}

function viewCommand(command: StateCommand): Command {
  return (view) => {
    if (view.composing) {
      return false;
    }
    return command({
      state: view.state,
      dispatch: (transaction) => view.dispatch(transaction),
    });
  };
}

function canRunStructuredCommand(state: EditorState): boolean {
  const projection = state.field(wysiwygProjectionField, false);
  return !projection || projection.compositionGuardRanges.length === 0;
}

interface ListLineTarget {
  readonly record: MarkdownRangeRecord;
  readonly marker: SourceRange;
  readonly lineFrom: number;
}

const indentListItems: StateCommand = ({ state, dispatch }) => {
  const targets = selectedListTargets(state);
  if (!targets) {
    return false;
  }
  const unit = state.facet(indentUnit);
  dispatch(
    state.update({
      changes: sortByPositionDescending(
        targets.map((target) => ({ from: target.marker.from, insert: unit })),
        (change) => change.from,
      ),
      userEvent: "input.indent",
    }),
  );
  return true;
};

const outdentListItems: StateCommand = ({ state, dispatch }) => {
  const targets = selectedListTargets(state);
  if (!targets) {
    return false;
  }
  const removals = targets.map((target) => removableListIndent(state, target));
  if (removals.some((range) => range === null)) {
    return false;
  }
  dispatch(
    state.update({
      changes: sortByPositionDescending(
        removals.map((range) => ({ from: range!.from, to: range!.to })),
        (change) => change.from,
      ),
      userEvent: "delete.dedent",
    }),
  );
  return true;
};

const deleteListMarkupBackward: StateCommand = (target) => {
  const { state, dispatch } = target;
  const listTargets = state.selection.ranges.map((range) =>
    range.empty ? listTargetAtVisibleContentStart(state, range.from) : null,
  );
  if (listTargets.every((item) => item !== null)) {
    const removals = listTargets.map((item) => removableListIndent(state, item!));
    if (removals.every((range) => range !== null)) {
      dispatch(
        state.update({
          changes: sortByPositionDescending(
            removals.map((range) => ({ from: range!.from, to: range!.to })),
            (change) => change.from,
          ),
          userEvent: "delete.dedent",
        }),
      );
      return true;
    }
    if (removals.some((range) => range !== null)) {
      return false;
    }
  }
  return deleteMarkupBackward(target);
};

export const deleteMarkdownMarkupBackward: StateCommand = guarded(
  (target) => deleteSelectedAtomBackward(target) || deleteListMarkupBackward(target),
);
export const deleteMarkdownAtomForward: StateCommand = guarded(deleteSelectedAtomForward);
export const selectMarkdownAtomBackward: StateCommand = guarded(selectAtomBackward);
export const selectMarkdownAtomForward: StateCommand = guarded(selectAtomForward);
export const moveMarkdownAtomUp: Command = (view) => moveAtomVertically(view, "backward");
export const moveMarkdownAtomDown: Command = (view) => moveAtomVertically(view, "forward");
export const clearMarkdownAtomSelection: StateCommand = guarded(clearSelectedAtoms);
export const indentMarkdownList: StateCommand = guarded(indentListItems);
export const outdentMarkdownList: StateCommand = guarded(outdentListItems);

function selectedListTargets(state: EditorState): readonly ListLineTarget[] | null {
  const targets = new Map<number, ListLineTarget>();
  for (const range of state.selection.ranges) {
    const end =
      range.to > range.from && state.doc.lineAt(range.to).from === range.to
        ? range.to - 1
        : range.to;
    for (
      let line = state.doc.lineAt(range.from);
      line.from <= end;
      line = state.doc.line(line.number + 1)
    ) {
      const target = selectedListTargetOnLine(state, line.from, line.to);
      if (!target) {
        return null;
      }
      targets.set(target.marker.from, target);
      if (line.to >= end || line.number === state.doc.lines) {
        break;
      }
    }
  }
  return sortByPositionDescending([...targets.values()], (target) => target.marker.from);
}

function listTargetAtVisibleContentStart(
  state: EditorState,
  position: number,
): ListLineTarget | null {
  const line = state.doc.lineAt(position);
  const target = selectedListTargetOnLine(state, line.from, line.to);
  if (!target) {
    return null;
  }
  const taskMarker = state
    .field(markdownRangeIndexField)
    .overlapping(line.from, line.to)
    .filter((record) => record.kind === "task")
    .flatMap((record) => record.markerRanges)
    .find(
      (marker) =>
        marker.from >= target.marker.to && state.doc.lineAt(marker.from).from === line.from,
    );
  const markerEnd = taskMarker?.to ?? target.marker.to;
  return skipHorizontalSpace(state, markerEnd, line.to) === position ? target : null;
}

function selectedListTargetOnLine(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
): ListLineTarget | null {
  const records = sortByPositionDescending(
    state
      .field(markdownRangeIndexField)
      .overlapping(lineFrom, lineTo)
      .filter(
        (record) =>
          (record.kind === "list-item-unordered" || record.kind === "list-item-ordered") &&
          record.markerRanges.some((marker) => state.doc.lineAt(marker.from).from === lineFrom),
      ),
    (record) => record.fullRange.from,
  );
  const record = records[0];
  const marker = record?.markerRanges.find(
    (candidate) => state.doc.lineAt(candidate.from).from === lineFrom,
  );
  return record && marker ? { record, marker, lineFrom } : null;
}

function removableListIndent(state: EditorState, target: ListLineTarget): SourceRange | null {
  const prefix = state.sliceDoc(target.lineFrom, target.marker.from);
  const trailingWhitespace = /[\t ]*$/u.exec(prefix)?.[0] ?? "";
  const structuralPrefix = prefix.slice(0, prefix.length - trailingWhitespace.length);
  const preservedSeparator =
    structuralPrefix.includes(">") && trailingWhitespace.length > 0 ? 1 : 0;
  const removableLength = trailingWhitespace.length - preservedSeparator;
  if (removableLength <= 0) {
    return null;
  }
  const unitLength = Math.max(1, state.facet(indentUnit).length);
  const to = target.marker.from;
  return { from: to - Math.min(unitLength, removableLength), to };
}

function skipHorizontalSpace(state: EditorState, from: number, to: number): number {
  let position = from;
  while (position < to && /[\t ]/u.test(state.sliceDoc(position, position + 1))) {
    position += 1;
  }
  return position;
}

function sortByPositionDescending<T>(values: readonly T[], position: (value: T) => number): T[] {
  const sorted: T[] = [];
  for (const value of values) {
    let index = 0;
    while (index < sorted.length && position(sorted[index]) >= position(value)) {
      index += 1;
    }
    sorted.splice(index, 0, value);
  }
  return sorted;
}
