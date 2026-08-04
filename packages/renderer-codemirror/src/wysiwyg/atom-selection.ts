import {
  EditorSelection,
  type StateEffect,
  Transaction,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { hasCurrentSourceFingerprint, isDefaultAtomRecord } from "./default-atom.ts";
import {
  clearWysiwygAtomSelectionEffect,
  hasWysiwygProjectionFeature,
  selectWysiwygAtomEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";

type SelectableAtom = MarkdownRangeRecord;
type DeletableAtom = MarkdownRangeRecord & {
  readonly kind: "image" | "thematic-break" | "table" | "html";
};

export const deleteSelectedAtomBackward: StateCommand = guarded((target) =>
  deleteExactlySelectedAtoms(target, "delete.backward"),
);
export const deleteSelectedAtomForward: StateCommand = guarded((target) =>
  deleteExactlySelectedAtoms(target, "delete.forward"),
);
export const selectAtomBackward: StateCommand = guarded((target) =>
  moveAcrossAtoms(target, "backward"),
);
export const selectAtomForward: StateCommand = guarded((target) =>
  moveAcrossAtoms(target, "forward"),
);
export function moveAtomVertically(view: EditorView, direction: "backward" | "forward"): boolean {
  const projection = view.state.field(wysiwygProjectionField, false);
  if (
    view.composing ||
    !projection ||
    projection.mode !== "wysiwyg" ||
    projection.compositionGuardRanges.length > 0
  ) {
    return false;
  }

  const targets = view.state.selection.ranges.map((range) =>
    verticalMovementTarget(view, range, direction),
  );
  if (targets.some((target) => target === null)) {
    return false;
  }
  const resolved = targets as readonly VerticalMovementTarget[];
  if (resolved.every((target) => target.kind === "native")) {
    return false;
  }

  const effects: StateEffect<unknown>[] = [clearWysiwygAtomSelectionEffect.of(null)];
  effects.push(
    ...resolved
      .filter(
        (target): target is Extract<VerticalMovementTarget, { readonly kind: "select" }> =>
          target.kind === "select",
      )
      .map((target) => selectWysiwygAtomEffect.of({ recordId: target.atom.id, extend: true })),
  );

  view.dispatch(
    view.state.update({
      selection: EditorSelection.create(
        resolved.map((target) => target.selection),
        view.state.selection.mainIndex,
      ),
      effects,
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select",
    }),
  );
  return true;
}
export const clearSelectedAtoms: StateCommand = guarded(({ state, dispatch }) => {
  const projection = state.field(wysiwygProjectionField, false);
  if (!projection || projection.selectedAtomIds.length === 0) {
    return false;
  }

  const selections = state.selection.ranges.map((range) => {
    const atom = exactlySelectedAtom(state, range);
    if (!atom) {
      return range;
    }
    return EditorSelection.cursor(
      range.head > range.anchor ? atom.fullRange.to : atom.fullRange.from,
    );
  });
  dispatch(
    state.update({
      selection: EditorSelection.create(selections, state.selection.mainIndex),
      effects: clearWysiwygAtomSelectionEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select",
    }),
  );
  return true;
});

export function selectWysiwygAtom(view: EditorView, recordId: string, extend = false): boolean {
  const atom = selectableAtomById(view.state, recordId);
  if (!atom) {
    return false;
  }
  const atomSelection = EditorSelection.range(atom.fullRange.from, atom.fullRange.to);
  const ranges = extend ? [...view.state.selection.ranges, atomSelection] : [atomSelection];
  view.dispatch({
    selection: EditorSelection.create(ranges, ranges.length - 1),
    effects: selectWysiwygAtomEffect.of({ recordId, extend }),
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select.pointer",
  });
  view.focus();
  return true;
}

function deleteExactlySelectedAtoms(
  { state, dispatch }: Parameters<StateCommand>[0],
  userEvent: "delete.backward" | "delete.forward",
): boolean {
  const atoms = state.selection.ranges.map((range) => exactlySelectedAtom(state, range));
  if (atoms.some((atom) => atom === null || !isDeletableAtom(atom))) {
    return false;
  }

  const uniqueAtoms = deduplicateAtoms(atoms as readonly DeletableAtom[]);
  dispatch(
    state.update({
      changes: atomDeletionChanges(uniqueAtoms),
      effects: clearWysiwygAtomSelectionEffect.of(null),
      userEvent,
    }),
  );
  return true;
}

function moveAcrossAtoms(
  { state, dispatch }: Parameters<StateCommand>[0],
  direction: "backward" | "forward",
): boolean {
  const targets = state.selection.ranges.map((range) => movementTarget(state, range, direction));
  if (targets.some((target) => target === null)) {
    return false;
  }

  const resolved = targets as readonly AtomMovementTarget[];
  const selectedAtoms = resolved.filter(
    (target): target is Extract<AtomMovementTarget, { readonly kind: "select" }> =>
      target.kind === "select",
  );
  const effects: StateEffect<unknown>[] = [clearWysiwygAtomSelectionEffect.of(null)];
  effects.push(
    ...selectedAtoms.map((target) =>
      selectWysiwygAtomEffect.of({ recordId: target.atom.id, extend: true }),
    ),
  );
  dispatch(
    state.update({
      selection: EditorSelection.create(
        resolved.map((target) => target.selection),
        state.selection.mainIndex,
      ),
      effects,
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select",
    }),
  );
  return true;
}

type AtomMovementTarget =
  | {
      readonly kind: "select";
      readonly atom: SelectableAtom;
      readonly selection: SelectionRange;
    }
  | { readonly kind: "exit"; readonly selection: SelectionRange };

type VerticalMovementTarget =
  | { readonly kind: "native"; readonly selection: SelectionRange }
  | { readonly kind: "reveal-image"; readonly selection: SelectionRange }
  | {
      readonly kind: "select";
      readonly atom: SelectableAtom;
      readonly selection: SelectionRange;
    };

function movementTarget(
  state: EditorState,
  range: SelectionRange,
  direction: "backward" | "forward",
): AtomMovementTarget | null {
  const selected = exactlySelectedAtom(state, range);
  if (selected) {
    return {
      kind: "exit",
      selection: EditorSelection.cursor(
        direction === "forward" ? selected.fullRange.to : selected.fullRange.from,
      ),
    };
  }
  if (!range.empty) {
    return null;
  }

  const atoms = state
    .field(markdownRangeIndexField)
    .records.filter((record) => isSelectableAtom(record, state))
    .filter((atom) =>
      direction === "forward"
        ? atom.fullRange.from === range.head
        : atom.fullRange.to === range.head,
    );
  if (atoms.length !== 1) {
    return null;
  }
  const atom = atoms[0];
  if (isKeyboardRevealAtom(atom, state)) {
    return {
      kind: "exit",
      selection: revealedSourceCursor(atom, direction),
    };
  }
  return {
    kind: "select",
    atom,
    selection:
      direction === "forward"
        ? EditorSelection.range(atom.fullRange.from, atom.fullRange.to)
        : EditorSelection.range(atom.fullRange.to, atom.fullRange.from),
  };
}

function verticalMovementTarget(
  view: EditorView,
  range: SelectionRange,
  direction: "backward" | "forward",
): VerticalMovementTarget | null {
  if (!range.empty) {
    return null;
  }

  const moved = view.moveVertically(range, direction === "forward");
  const atoms = view.state
    .field(markdownRangeIndexField)
    .records.filter((record) => isKeyboardProjectedAtom(record, view.state))
    .filter((record) => verticalMoveHitsAtom(record, range, moved, direction));
  if (atoms.length !== 1) {
    return { kind: "native", selection: moved };
  }

  const atom = atoms[0];
  if (!isKeyboardRevealAtom(atom, view.state)) {
    return {
      kind: "select",
      atom,
      selection:
        direction === "forward"
          ? EditorSelection.range(atom.fullRange.from, atom.fullRange.to, moved.goalColumn)
          : EditorSelection.range(atom.fullRange.to, atom.fullRange.from, moved.goalColumn),
    };
  }
  return {
    kind: "reveal-image",
    selection: revealedSourceCursor(
      atom,
      moved.head <= atom.fullRange.from ? "forward" : "backward",
      moved,
    ),
  };
}

function revealedSourceCursor(
  atom: MarkdownRangeRecord,
  direction: "backward" | "forward",
  movement?: SelectionRange,
): SelectionRange {
  if (atom.kind === "image") {
    const minimum = atom.fullRange.from + 1;
    const maximum = atom.fullRange.to - 1;
    const preferred = direction === "forward" ? (atom.contentRange?.from ?? minimum) : maximum;
    const position = Math.max(minimum, Math.min(maximum, preferred));
    return EditorSelection.cursor(position, movement?.assoc, undefined, movement?.goalColumn);
  }
  // 表格：光标进入表头行首个 cell 内容之后，让源码立即回显。
  const minimum = atom.fullRange.from + 1;
  const maximum = Math.max(minimum, atom.fullRange.to - 1);
  const position = direction === "forward" ? minimum : maximum;
  return EditorSelection.cursor(position, movement?.assoc, undefined, movement?.goalColumn);
}

function positionIsInside(record: MarkdownRangeRecord, position: number): boolean {
  return position > record.fullRange.from && position < record.fullRange.to;
}

/**
 * 判定一次纵向视觉移动是否"进入/跨过"某个投影 atom（表格/图片/分割线）。
 * 表格是整块 block widget：从上方一行向下移动时，CM6 的视觉落点可能
 * 直接落在 widget 之后（moved.head > fullRange.to），此时同样视为命中，
 * 保证 ArrowDown 与 ArrowUp 行为对称（进入即原子选中整表）。
 */
function verticalMoveHitsAtom(
  record: MarkdownRangeRecord,
  range: SelectionRange,
  moved: SelectionRange,
  direction: "backward" | "forward",
): boolean {
  if (positionIsInside(record, range.head)) {
    return false;
  }
  if (direction === "forward") {
    return range.head < record.fullRange.from && moved.head >= record.fullRange.from;
  }
  return range.head > record.fullRange.to && moved.head <= record.fullRange.to;
}

function exactlySelectedAtom(state: EditorState, range: SelectionRange): SelectableAtom | null {
  if (range.empty) {
    return null;
  }
  const atom = state
    .field(markdownRangeIndexField)
    .records.find(
      (record): record is SelectableAtom =>
        isSelectableAtom(record, state) &&
        record.fullRange.from === range.from &&
        record.fullRange.to === range.to,
    );
  return atom ?? null;
}

function selectableAtomById(state: EditorState, recordId: string): SelectableAtom | null {
  const record = state.field(markdownRangeIndexField).get(recordId);
  return record && isSelectableAtom(record, state) ? record : null;
}

function isSelectableAtom(record: MarkdownRangeRecord, state: EditorState): boolean {
  return (
    record.parserCoverage === "complete" &&
    ((record.editPolicy === "atom-delete" &&
      (record.kind === "image" || record.kind === "thematic-break")) ||
      (hasWysiwygProjectionFeature(state, "default-atoms") &&
        isDefaultAtomRecord(record) &&
        hasCurrentSourceFingerprint(record, state)) ||
      (hasWysiwygProjectionFeature(state, "tables") &&
        record.kind === "table" &&
        record.renderPolicy === "table-widget") ||
      (hasWysiwygProjectionFeature(state, "html") &&
        record.kind === "html" &&
        record.renderPolicy === "html-widget"))
  );
}

function isKeyboardRevealAtom(record: MarkdownRangeRecord, state: EditorState): boolean {
  // 表格始终显示网格并在单元格内编辑，Arrow 进入时原子选中整表（不回显源码）。
  return isSelectableAtom(record, state) && record.interactionPolicy === "reveal-source";
}

function isKeyboardProjectedAtom(record: MarkdownRangeRecord, state: EditorState): boolean {
  if (!isSelectableAtom(record, state)) {
    return false;
  }
  if (record.kind === "image") {
    return hasWysiwygProjectionFeature(state, "images");
  }
  if (record.kind === "thematic-break") {
    return hasWysiwygProjectionFeature(state, "thematic-breaks");
  }
  if (record.kind === "table") {
    return hasWysiwygProjectionFeature(state, "tables");
  }
  if (record.kind === "html") {
    return hasWysiwygProjectionFeature(state, "html");
  }
  return true;
}

function isDeletableAtom(record: SelectableAtom): record is DeletableAtom {
  return (
    (record.editPolicy === "atom-delete" &&
      (record.kind === "image" || record.kind === "thematic-break")) ||
    (record.kind === "table" &&
      record.renderPolicy === "table-widget" &&
      record.editPolicy === "structured") ||
    (record.kind === "html" &&
      record.renderPolicy === "html-widget" &&
      record.editPolicy === "structured")
  );
}

function deduplicateAtoms(atoms: readonly DeletableAtom[]): readonly DeletableAtom[] {
  return [...new Map(atoms.map((atom) => [atom.id, atom])).values()];
}

function atomDeletionChanges(
  atoms: readonly DeletableAtom[],
): readonly { readonly from: number; readonly to: number }[] {
  const changes: { from: number; to: number }[] = [];
  for (const atom of atoms) {
    const change = { from: atom.fullRange.from, to: atom.fullRange.to };
    const index = changes.findIndex((existing) => existing.from < change.from);
    changes.splice(index === -1 ? changes.length : index, 0, change);
  }
  return changes;
}

function guarded(command: StateCommand): StateCommand {
  return (target) => {
    const projection = target.state.field(wysiwygProjectionField, false);
    if (!projection) {
      return command(target);
    }
    return projection.mode === "wysiwyg" && projection.compositionGuardRanges.length === 0
      ? command(target)
      : false;
  };
}
