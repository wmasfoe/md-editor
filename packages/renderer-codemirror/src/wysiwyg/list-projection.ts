import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType, type EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics, type WysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { toggleTaskMarkerAt } from "./task-toggle.ts";

const taskWidgetListeners = new WeakMap<HTMLElement, readonly EventListener[]>();

function preventTaskWidgetSelection(event: Event): void {
  event.preventDefault();
}

type BlockKind = "quote" | "list-item-unordered" | "list-item-ordered" | "task";
type BlockRecord = MarkdownRangeRecord & { readonly kind: BlockKind };

export function buildBlockLayoutDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    record.renderPolicy !== "marker-hidden" ||
    !isBlockRecord(record)
  ) {
    return [];
  }

  const decorations: Range<Decoration>[] = [];
  for (const marker of record.markerRanges) {
    const replacement = markerReplacementRange(state, record.kind, marker);
    const widget =
      record.kind === "task"
        ? new TaskCheckboxWidget({
            recordId: record.id,
            from: marker.from,
            to: marker.to,
            checked: isCheckedTaskMarker(state.sliceDoc(marker.from, marker.to)),
            diagnostics: getWysiwygDiagnostics(state),
          })
        : new BlockMarkerWidget(record.kind, visibleMarker(state, record, marker));
    decorations.push(
      Decoration.replace({
        widget,
        inclusive: false,
        wysiwygRecordId: record.id,
        wysiwygRole: `${record.kind}-marker-hidden`,
      }).range(replacement.from, replacement.to),
    );
    decorations.push(
      Decoration.line({
        class: blockLineClass(record.kind),
        attributes: { "data-markdown-kind": record.kind },
        wysiwygRecordId: record.id,
        wysiwygRole: `${record.kind}-line`,
      }).range(state.doc.lineAt(marker.from).from),
    );
  }
  return decorations;
}

export function buildBlockAtomicRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    record.renderPolicy !== "marker-hidden" ||
    !isBlockRecord(record)
  ) {
    return [];
  }
  return record.markerRanges.map((marker) => {
    const range = markerReplacementRange(state, record.kind, marker);
    return Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: `${record.kind}-marker-atomic`,
    }).range(range.from, range.to);
  });
}

export class BlockMarkerWidget extends WidgetType {
  constructor(
    readonly kind: Exclude<BlockRecord["kind"], "task">,
    readonly label: string,
  ) {
    super();
  }

  eq(other: BlockMarkerWidget): boolean {
    return this.kind === other.kind && this.label === other.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const marker = view.dom.ownerDocument.createElement("span");
    marker.className = `cm-md-block-marker cm-md-block-marker--${this.kind}`;
    marker.dataset.markdownKind = this.kind;
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.label;
    return marker;
  }
}

export interface TaskCheckboxWidgetValue {
  readonly recordId: string;
  readonly from: number;
  readonly to: number;
  readonly checked: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly value: TaskCheckboxWidgetValue) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.from === other.value.from &&
      this.value.to === other.value.to &&
      this.value.checked === other.value.checked
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = view.dom.ownerDocument.createElement("span");
    checkbox.className = "cm-md-task-checkbox";
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("tabindex", "-1");
    checkbox.setAttribute("aria-label", "Toggle task");
    updateTaskCheckboxDom(checkbox, this.value);

    const toggle: EventListener = (event) => {
      event.preventDefault();
      const from = Number.parseInt(checkbox.dataset.taskFrom ?? "", 10);
      const to = Number.parseInt(checkbox.dataset.taskTo ?? "", 10);
      const recordId = checkbox.dataset.taskRecordId;
      if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && recordId) {
        toggleTaskMarkerAt(view, { recordId, from, to });
      }
    };
    checkbox.addEventListener("pointerdown", preventTaskWidgetSelection);
    checkbox.addEventListener("click", toggle);
    taskWidgetListeners.set(checkbox, [preventTaskWidgetSelection, toggle]);
    this.value.diagnostics?.recordWidgetLifecycle("task", "create");
    return checkbox;
  }

  updateDOM(dom: HTMLElement, _view: EditorView, _previous: this): boolean {
    updateTaskCheckboxDom(dom, this.value);
    this.value.diagnostics?.recordWidgetLifecycle("task", "update");
    return true;
  }

  destroy(dom: HTMLElement): void {
    const listeners = taskWidgetListeners.get(dom);
    if (listeners) {
      dom.removeEventListener("pointerdown", listeners[0]);
      dom.removeEventListener("click", listeners[1]);
      taskWidgetListeners.delete(dom);
    }
    this.value.diagnostics?.recordWidgetLifecycle("task", "destroy");
  }
}

function updateTaskCheckboxDom(dom: HTMLElement, value: TaskCheckboxWidgetValue): void {
  dom.dataset.taskRecordId = value.recordId;
  dom.dataset.taskFrom = String(value.from);
  dom.dataset.taskTo = String(value.to);
  dom.setAttribute("aria-checked", String(value.checked));
  dom.classList.toggle("cm-md-task-checkbox--checked", value.checked);
}

function markerReplacementRange(
  state: EditorState,
  kind: BlockRecord["kind"],
  marker: SourceRange,
): SourceRange {
  if (kind === "task") {
    return marker;
  }
  const lineEnd = state.doc.lineAt(marker.to).to;
  let to = marker.to;
  const maximumPadding = kind === "quote" ? 1 : Number.POSITIVE_INFINITY;
  while (
    to < lineEnd &&
    to - marker.to < maximumPadding &&
    /[\t ]/u.test(state.sliceDoc(to, to + 1))
  ) {
    to += 1;
  }
  return { from: marker.from, to };
}

function isBlockRecord(record: MarkdownRangeRecord): record is BlockRecord {
  return ["quote", "list-item-unordered", "list-item-ordered", "task"].includes(record.kind);
}

function isCheckedTaskMarker(marker: string): boolean {
  return marker === "[x]" || marker === "[X]";
}

function visibleMarker(
  state: { sliceDoc(from: number, to: number): string },
  record: BlockRecord,
  marker: SourceRange,
): string {
  if (record.kind === "quote") {
    return "›";
  }
  if (record.kind === "list-item-unordered") {
    return "•";
  }
  return state.sliceDoc(marker.from, marker.to);
}

function blockLineClass(kind: BlockRecord["kind"]): string {
  return `cm-md-block-line cm-md-block-line--${kind}`;
}
