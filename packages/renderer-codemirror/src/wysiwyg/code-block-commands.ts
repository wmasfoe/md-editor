import { indentUnit } from "@codemirror/language";
import {
  EditorSelection,
  Facet,
  Prec,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { CODE_BLOCK_LANGUAGES } from "../markdown/code-languages.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type {
  MarkdownCodeBlockMetadata,
  MarkdownRangeRecord,
  SourceRange,
} from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import {
  getEmptyFencedCodeBlockBodyAnchor,
  getFencedCodeBlockBodyRange,
  isProjectableCodeBlock,
} from "./code-block-projection.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

export type WriteClipboardText = (text: string) => Promise<void>;

export interface CodeBlockLanguageChoice {
  readonly label: string;
  readonly token: string;
}

export const PLAIN_CODE_BLOCK_LANGUAGE: CodeBlockLanguageChoice = Object.freeze({
  label: "Plain",
  token: "",
});

export const CODE_BLOCK_LANGUAGE_CHOICES: readonly CodeBlockLanguageChoice[] = Object.freeze([
  PLAIN_CODE_BLOCK_LANGUAGE,
  ...CODE_BLOCK_LANGUAGES.map((language) =>
    Object.freeze({
      label: language.name,
      token: language.alias[0] ?? language.name.toLowerCase(),
    }),
  ),
]);

export const codeBlockClipboardFacet = Facet.define<WriteClipboardText, WriteClipboardText | null>({
  combine(values) {
    return values.at(-1) ?? null;
  },
});

export function provideCodeBlockClipboard(writeClipboardText?: WriteClipboardText): Extension {
  return writeClipboardText ? [codeBlockClipboardFacet.of(writeClipboardText)] : [];
}

export const codeBlockKeymap = Prec.highest(
  keymap.of([
    { key: "Enter", run: codeBlockEnter },
    { key: "Tab", run: codeBlockTab },
    { key: "Shift-Tab", run: codeBlockShiftTab },
    { key: "Backspace", run: codeBlockBackspace },
    { key: "Delete", run: codeBlockDelete },
    { key: "Mod-a", run: codeBlockSelectAll },
  ]),
);

export const codeBlockEmptyBodyInputHandler = EditorView.inputHandler.of(
  (view, from, to, text, insert) => {
    if (
      from !== to ||
      text.length === 0 ||
      view.state.selection.ranges.length !== 1 ||
      view.state.selection.main.from !== from ||
      view.state.selection.main.to !== to
    ) {
      return false;
    }
    const emptyBody = emptyFencedCodeBlockAtPosition(view.state, from);
    if (!emptyBody) {
      return false;
    }

    const defaultTransaction = insert();
    const lineBreak = view.state.lineBreak;
    const hasTrailingLineBreak = text.endsWith(lineBreak);
    const insertedText = hasTrailingLineBreak ? text : `${text}${lineBreak}`;
    const selectionOffset = hasTrailingLineBreak ? text.length - lineBreak.length : text.length;
    const userEvent = defaultTransaction.annotation(Transaction.userEvent);
    const addToHistory = defaultTransaction.annotation(Transaction.addToHistory);
    view.dispatch({
      changes: { from: emptyBody.anchor, insert: insertedText },
      selection: EditorSelection.cursor(emptyBody.anchor + Math.max(0, selectionOffset)),
      annotations: [
        authorizeWysiwygProtectedChange.of(true),
        ...(userEvent ? [Transaction.userEvent.of(userEvent)] : []),
        ...(addToHistory === undefined ? [] : [Transaction.addToHistory.of(addToHistory)]),
      ],
      scrollIntoView: defaultTransaction.scrollIntoView,
    });
    return true;
  },
);

export const codeBlockEmptyBodyPointerHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const frame = view.dom.ownerDocument.defaultView;
    if (event.button !== 0 || !frame || !(event.target instanceof frame.HTMLElement)) {
      return false;
    }
    const codeLine = (event.target as HTMLElement).closest<HTMLElement>(".cm-md-code-line");
    const recordId = codeLine?.dataset.mdCodeBlockId;
    if (!recordId) {
      return false;
    }
    const record = codeBlockRecordById(view.state, recordId);
    const anchor = record ? getEmptyFencedCodeBlockBodyAnchor(view.state, record) : null;
    if (anchor === null) {
      return false;
    }
    event.preventDefault();
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      annotations: Transaction.addToHistory.of(false),
      userEvent: "select.pointer",
    });
    view.focus();
    return true;
  },
});

export function codeBlockRecordById(
  state: EditorState,
  recordId: string,
): MarkdownRangeRecord | null {
  const record = state.field(markdownRangeIndexField).get(recordId);
  return record && isProjectableCodeBlock(record) ? record : null;
}

export function currentCodeBlockRecord(state: EditorState): MarkdownRangeRecord | null {
  if (state.field(editorModeField) === "source" || state.selection.ranges.length !== 1) {
    return null;
  }
  const range = state.selection.main;
  const candidates = state
    .field(markdownRangeIndexField)
    .overlapping(range.from, range.to)
    .filter(
      (record) =>
        isProjectableCodeBlock(record) &&
        selectionIntersectsBody(state, record, range.from, range.to),
    );
  return candidates[0] ?? null;
}

export function readCodeBlockBodyText(state: EditorState, record: MarkdownRangeRecord): string {
  const metadata = requireCodeBlock(record);
  if (metadata.blockKind === "fenced") {
    return readFencedBodyText(state, record);
  }
  return readIndentedBodyText(state, metadata);
}

export function selectCodeBlockBodyById(view: EditorView, recordId: string): boolean {
  const record = codeBlockRecordById(view.state, recordId);
  const selection = record ? codeBlockBodySelection(view.state, record) : null;
  if (!selection) {
    return false;
  }
  view.dispatch({
    selection,
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select.code-block-body",
  });
  view.focus();
  return true;
}

export async function copyCodeBlockBodyById(view: EditorView, recordId: string): Promise<boolean> {
  const writer = view.state.facet(codeBlockClipboardFacet);
  const record = codeBlockRecordById(view.state, recordId);
  const diagnostics = getWysiwygDiagnostics(view.state);
  diagnostics?.recordCodeBlockCopyInvocation();
  if (!writer || !record) {
    diagnostics?.recordCodeBlockCopyFailure();
    announce(view, "Code copy failed.");
    return false;
  }
  const body = readCodeBlockBodyText(view.state, record);
  try {
    await writer(body);
    diagnostics?.recordCodeBlockCopySuccess();
    announce(view, "Code copied.");
    return true;
  } catch {
    diagnostics?.recordCodeBlockCopyFailure();
    announce(view, "Code copy failed.");
    return false;
  }
}

export function setCodeBlockLanguageById(
  view: EditorView,
  recordId: string,
  token: string,
): boolean {
  const record = codeBlockRecordById(view.state, recordId);
  if (!record || record.codeBlock?.blockKind !== "fenced") {
    return false;
  }
  return setCodeBlockLanguage(view, record, token);
}

export function codeBlockEnter(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view)) return false;
  const emptyBodies = selectedEmptyFencedCodeBlockBodies(view.state);
  if (emptyBodies) return materializeEmptyFencedBodies(view, emptyBodies, "");
  const targets = selectedCodeBlockLineTargets(view.state);
  if (!targets || targets.some((target) => !target.selection.empty)) return false;
  const changes = targets.map((target) => {
    if (target.record.codeBlock?.blockKind === "indented") {
      return {
        from: target.selection.from,
        insert: `\n${structuralIndentForLine(view.state, target.record, target.selection.from)}`,
      };
    }
    return { from: target.selection.from, insert: "\n" };
  });
  const singleCursor = targets.length === 1 ? targets[0] : null;
  const singleInsert = singleCursor ? changes[0] : null;
  view.dispatch(
    view.state.update({
      changes: sortChanges(changes),
      selection:
        singleCursor && singleInsert
          ? EditorSelection.cursor(singleCursor.selection.from + singleInsert.insert.length)
          : undefined,
      annotations: targets.some((target) => target.record.codeBlock?.blockKind === "indented")
        ? authorizeWysiwygProtectedChange.of(true)
        : undefined,
      userEvent: "input",
    }),
  );
  return true;
}

export function codeBlockTab(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view)) return false;
  const unit = view.state.facet(indentUnit);
  const emptyBodies = selectedEmptyFencedCodeBlockBodies(view.state);
  if (emptyBodies) return materializeEmptyFencedBodies(view, emptyBodies, unit);
  const targets = selectedCodeBlockLineTargets(view.state);
  if (!targets) return false;
  const changes = view.state.selection.ranges.every((selection) => selection.empty)
    ? view.state.selection.ranges.map((selection) => ({
        from: selection.from,
        to: selection.to,
        insert: unit,
      }))
    : uniqueLineStarts(targets).map((from) => ({ from, insert: unit }));
  view.dispatch(
    view.state.update({
      changes: sortChanges(changes),
      userEvent: "input.indent",
    }),
  );
  return true;
}

export function codeBlockShiftTab(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view)) return false;
  const targets = selectedCodeBlockLineTargets(view.state);
  if (!targets) return false;
  const removals = targets
    .map((target) => removableSemanticIndent(view.state, target.line.from, target.line.to))
    .filter((range): range is SourceRange => range !== null);
  if (removals.length === 0) return true;
  view.dispatch(
    view.state.update({
      changes: sortChanges(removals.map((range) => ({ from: range.from, to: range.to }))),
      userEvent: "delete.dedent",
    }),
  );
  return true;
}

export function codeBlockBackspace(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view)) return false;
  return handleCodeBlockBoundaryDelete(view, "backward");
}

export function codeBlockDelete(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view)) return false;
  return handleCodeBlockBoundaryDelete(view, "forward");
}

export function codeBlockSelectAll(view: EditorView): boolean {
  if (!canRunCodeBlockCommand(view) || view.state.selection.ranges.length !== 1) return false;
  const record = currentCodeBlockRecord(view.state);
  if (!record) return false;
  const selection = codeBlockBodySelection(view.state, record);
  if (!selection) return false;
  const current = view.state.selection.main;
  if (!current.empty && current.from === selection.main.from && current.to === selection.main.to) {
    return false;
  }
  view.dispatch({
    selection,
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select.code-block-body",
  });
  return true;
}

function setCodeBlockLanguage(
  view: EditorView,
  record: MarkdownRangeRecord,
  requestedToken: string,
): boolean {
  const metadata = requireCodeBlock(record);
  const rawInfoRange = metadata.rawInfoRange;
  const languageTokenRange = metadata.languageTokenRange;
  if (!languageTokenRange) {
    if (requestedToken === "" || !metadata.openingFenceRange) return false;
    view.dispatch(
      view.state.update({
        changes: {
          from: rawInfoRange?.from ?? metadata.openingFenceRange.to,
          insert: requestedToken,
        },
        annotations: authorizeWysiwygProtectedChange.of(true),
        userEvent: "input.code-block-language",
      }),
    );
    return true;
  }
  const suffix = metadata.infoSuffixRange
    ? view.state.sliceDoc(metadata.infoSuffixRange.from, metadata.infoSuffixRange.to)
    : "";
  const hasNonWhitespaceSuffix = /\S/u.test(suffix);
  const replacement =
    requestedToken === "" ? (hasNonWhitespaceSuffix ? "text" : "") : requestedToken;
  view.dispatch(
    view.state.update({
      changes: {
        from: languageTokenRange.from,
        to: languageTokenRange.to,
        insert: replacement,
      },
      annotations: authorizeWysiwygProtectedChange.of(true),
      userEvent: "input.code-block-language",
    }),
  );
  return true;
}

function canRunCodeBlockCommand(view: EditorView): boolean {
  const projection = view.state.field(wysiwygProjectionField, false);
  return !view.composing && (!projection || projection.compositionGuardRanges.length === 0);
}

function handleCodeBlockBoundaryDelete(
  view: EditorView,
  direction: "backward" | "forward",
): boolean {
  if (view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
  const position = view.state.selection.main.from;
  if (emptyFencedCodeBlockAtPosition(view.state, position)) {
    announce(view, "Code block syntax is protected.");
    getWysiwygDiagnostics(view.state)?.recordProtectedChangeRejection();
    return true;
  }
  const record = currentCodeBlockRecordForRange(view.state, position, position);
  if (record && isAtSemanticBoundary(view.state, record, position, direction)) {
    announce(view, "Code block syntax is protected.");
    getWysiwygDiagnostics(view.state)?.recordProtectedChangeRejection();
    return true;
  }
  return false;
}

interface CodeBlockLineTarget {
  readonly record: MarkdownRangeRecord;
  readonly selection: { readonly from: number; readonly to: number; readonly empty: boolean };
  readonly line: { readonly from: number; readonly to: number };
}

function selectedCodeBlockLineTargets(state: EditorState): readonly CodeBlockLineTarget[] | null {
  if (state.field(editorModeField) === "source") return null;
  const targets = new Map<number, CodeBlockLineTarget>();
  for (const selection of state.selection.ranges) {
    const record = currentCodeBlockRecordForRange(state, selection.from, selection.to);
    if (!record || !selectionIntersectsBody(state, record, selection.from, selection.to)) {
      return null;
    }
    const end =
      selection.to > selection.from && state.doc.lineAt(selection.to).from === selection.to
        ? selection.to - 1
        : selection.to;
    for (
      let line = state.doc.lineAt(selection.from);
      line.from <= end;
      line = state.doc.line(line.number + 1)
    ) {
      const semantic = semanticLineRange(state, record, line.from);
      if (!semantic) return null;
      targets.set(semantic.from, { record, selection, line: semantic });
      if (line.to >= end || line.number === state.doc.lines) break;
    }
  }
  const orderedTargets = [...targets.values()];
  // oxlint-disable-next-line unicorn/no-array-sort -- The production TypeScript target is ES2022.
  orderedTargets.sort((left, right) => left.line.from - right.line.from);
  return Object.freeze(orderedTargets);
}

function currentCodeBlockRecordForRange(
  state: EditorState,
  from: number,
  to: number,
): MarkdownRangeRecord | null {
  const candidates = state
    .field(markdownRangeIndexField)
    .overlapping(from, to)
    .filter(
      (record) =>
        isProjectableCodeBlock(record) && selectionIntersectsBody(state, record, from, to),
    );
  return candidates.length === 1 ? candidates[0] : null;
}

function selectionIntersectsBody(
  state: EditorState,
  record: MarkdownRangeRecord,
  from: number,
  to: number,
): boolean {
  const metadata = requireCodeBlock(record);
  const bodyRange =
    metadata.blockKind === "fenced" ? getFencedCodeBlockBodyRange(state, record) : null;
  if (bodyRange) {
    if (bodyRange.from === bodyRange.to) {
      return from === to && (from === bodyRange.from || from === metadata.closingFenceRange?.to);
    }
    return from === to
      ? from >= bodyRange.from && from <= bodyRange.to
      : from < bodyRange.to && to > bodyRange.from;
  }
  return metadata.bodySegments.some((segment) =>
    from === to
      ? from >= segment.from && from <= segment.to
      : from < segment.to && to > segment.from,
  );
}

function readFencedBodyText(state: EditorState, record: MarkdownRangeRecord): string {
  const metadata = requireCodeBlock(record);
  const bodyRange = getFencedCodeBlockBodyRange(state, record);
  if (bodyRange) {
    return state.sliceDoc(bodyRange.from, bodyRange.to);
  }
  return metadata.bodySegments.map((segment) => state.sliceDoc(segment.from, segment.to)).join("");
}

function readIndentedBodyText(state: EditorState, metadata: MarkdownCodeBlockMetadata): string {
  const lines: string[] = [];
  const lineRange = indentedSemanticLineEnvelope(metadata);
  for (
    let line = state.doc.lineAt(lineRange.from);
    line.from <= lineRange.to;
    line = state.doc.line(line.number + 1)
  ) {
    const structural = metadata.syntaxIndentRanges.find((range) => range.from === line.from);
    lines.push(state.sliceDoc(structural?.to ?? line.from, line.to));
    if (line.to >= lineRange.to || line.number === state.doc.lines) break;
  }
  return lines.join("\n");
}

function indentedSemanticLineEnvelope(metadata: MarkdownCodeBlockMetadata): SourceRange {
  const ranges = [...metadata.bodySegments, ...metadata.syntaxIndentRanges];
  if (ranges.length === 0) {
    return metadata.sourceBlockRange;
  }
  return {
    from: Math.min(...ranges.map((range) => range.from)),
    to: Math.max(...ranges.map((range) => range.to)),
  };
}

function codeBlockBodySelection(
  state: EditorState,
  record: MarkdownRangeRecord,
): EditorSelection | null {
  const metadata = requireCodeBlock(record);
  const fencedRange =
    metadata.blockKind === "fenced" ? getFencedCodeBlockBodyRange(state, record) : null;
  if (fencedRange) {
    return EditorSelection.single(fencedRange.from, fencedRange.to);
  }
  if (metadata.bodySegments.length === 0) {
    const position = metadata.bodyEnvelopeRange?.from ?? metadata.sourceBlockRange.from;
    return EditorSelection.single(position);
  }
  return EditorSelection.single(
    metadata.bodySegments[0].from,
    metadata.bodySegments.at(-1)?.to ?? metadata.bodySegments[0].to,
  );
}

function semanticLineRange(
  state: EditorState,
  record: MarkdownRangeRecord,
  lineFrom: number,
): SourceRange | null {
  const metadata = requireCodeBlock(record);
  const line = state.doc.lineAt(lineFrom);
  if (metadata.blockKind === "indented") {
    const structural = metadata.syntaxIndentRanges.find((range) => range.from === line.from);
    return { from: structural?.to ?? line.from, to: line.to };
  }
  const emptyBodyAnchor = getEmptyFencedCodeBlockBodyAnchor(state, record);
  if (emptyBodyAnchor !== null && line.from === emptyBodyAnchor) {
    return { from: emptyBodyAnchor, to: emptyBodyAnchor };
  }
  const segment = metadata.bodySegments.find(
    (range) => line.from <= range.to && line.to >= range.from,
  );
  return segment
    ? { from: Math.max(line.from, segment.from), to: Math.min(line.to, segment.to) }
    : null;
}

function structuralIndentForLine(
  state: EditorState,
  record: MarkdownRangeRecord,
  position: number,
): string {
  const line = state.doc.lineAt(position);
  const structural = record.codeBlock?.syntaxIndentRanges.find((range) => range.from === line.from);
  if (structural) {
    return state.sliceDoc(structural.from, structural.to);
  }
  return (
    state.sliceDoc(line.from, Math.min(line.from + 4, line.to)).match(/^[ \t]*/u)?.[0] ?? "    "
  );
}

function removableSemanticIndent(state: EditorState, from: number, to: number): SourceRange | null {
  if (from >= to) return null;
  const first = state.sliceDoc(from, from + 1);
  if (first === "\t") return { from, to: from + 1 };
  const prefix = state.sliceDoc(from, Math.min(from + state.facet(indentUnit).length, to));
  const spaces = prefix.match(/^ {1,2}/u)?.[0] ?? "";
  return spaces.length > 0 ? { from, to: from + spaces.length } : null;
}

function isAtSemanticBoundary(
  state: EditorState,
  record: MarkdownRangeRecord,
  position: number,
  direction: "backward" | "forward",
): boolean {
  const selection = codeBlockBodySelection(state, record);
  if (!selection) return false;
  return direction === "backward"
    ? position === selection.main.from
    : position === selection.main.to;
}

function requireCodeBlock(record: MarkdownRangeRecord): MarkdownCodeBlockMetadata {
  if (!record.codeBlock) throw new Error("Expected a code-block record.");
  return record.codeBlock;
}

function sortChanges<T extends { readonly from: number }>(changes: readonly T[]): readonly T[] {
  const orderedChanges = [...changes];
  // oxlint-disable-next-line unicorn/no-array-sort -- The production TypeScript target is ES2022.
  orderedChanges.sort((left, right) => left.from - right.from);
  return Object.freeze(orderedChanges);
}

function uniqueLineStarts(targets: readonly CodeBlockLineTarget[]): readonly number[] {
  return Object.freeze([...new Set(targets.map((target) => target.line.from))]);
}

function announce(view: EditorView, text: string): void {
  view.dispatch({
    effects: EditorView.announce.of(text),
    annotations: Transaction.addToHistory.of(false),
  });
}

interface EmptyFencedCodeBlockBody {
  readonly record: MarkdownRangeRecord;
  readonly anchor: number;
}

function emptyFencedCodeBlockAtPosition(
  state: EditorState,
  position: number,
): EmptyFencedCodeBlockBody | null {
  if (state.field(editorModeField) === "source") {
    return null;
  }
  const candidates = state
    .field(markdownRangeIndexField)
    .overlapping(position, position)
    .flatMap((record) => {
      if (!isProjectableCodeBlock(record)) {
        return [];
      }
      const anchor = getEmptyFencedCodeBlockBodyAnchor(state, record);
      if (
        anchor === null ||
        (position !== anchor && position !== record.codeBlock?.closingFenceRange?.to)
      ) {
        return [];
      }
      return [{ record, anchor }];
    });
  return candidates.length === 1 ? candidates[0] : null;
}

function selectedEmptyFencedCodeBlockBodies(
  state: EditorState,
): readonly EmptyFencedCodeBlockBody[] | null {
  if (state.selection.ranges.some((selection) => !selection.empty)) {
    return null;
  }
  const bodies = state.selection.ranges.map((selection) =>
    emptyFencedCodeBlockAtPosition(state, selection.from),
  );
  if (bodies.some((body) => body === null)) {
    return null;
  }
  return Object.freeze(bodies as EmptyFencedCodeBlockBody[]);
}

function materializeEmptyFencedBodies(
  view: EditorView,
  bodies: readonly EmptyFencedCodeBlockBody[],
  prefix: string,
): boolean {
  const anchors = [...new Set(bodies.map((body) => body.anchor))];
  const insert = `${prefix}${view.state.lineBreak}`;
  const changes = view.state.changes(anchors.map((from) => ({ from, insert })));
  const selection = EditorSelection.create(
    anchors.map((anchor) => EditorSelection.cursor(changes.mapPos(anchor, -1) + prefix.length)),
  );
  view.dispatch(
    view.state.update({
      changes,
      selection,
      annotations: authorizeWysiwygProtectedChange.of(true),
      userEvent: prefix ? "input.indent" : "input",
    }),
  );
  return true;
}
