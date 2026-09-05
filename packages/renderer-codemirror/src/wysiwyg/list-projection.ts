import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType, type EditorView } from "@codemirror/view";
import { getWysiwygDiagnostics, type WysiwygDiagnostics } from "../diagnostics.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { toggleTaskMarkerAt } from "./task-toggle.ts";
import { CalloutHeaderWidget } from "./callout-widget.ts";

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
  const doc = state.doc;

  // GFM Alert / Callout 警示框处理（> [!NOTE] 等）
  if (record.alert) {
    const alert = record.alert;
    const startLine = doc.lineAt(record.fullRange.from);
    const safeTo =
      record.fullRange.to > record.fullRange.from &&
      doc.sliceString(record.fullRange.to - 1, record.fullRange.to) === "\n"
        ? record.fullRange.to - 1
        : record.fullRange.to;
    const endLine = doc.lineAt(safeTo);

    // 1. 为 Alert 内部各行挂载 Line Decoration（设置强调边框、浅色背景与圆角）
    for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
      const curLine = doc.line(lineNo);
      const isFirst = lineNo === startLine.number;
      const isLast = lineNo === endLine.number;
      const isEmptyQuoteLine = /^\s*>\s*$/.test(curLine.text);

      const classNames = [
        "cm-md-block-line",
        "cm-md-block-line--quote",
        "cm-md-alert",
        `cm-md-alert--${alert.alertType}`,
        isFirst ? "cm-md-alert--first" : "",
        isLast ? "cm-md-alert--last" : "",
        isEmptyQuoteLine ? "cm-md-alert--empty" : "",
      ]
        .filter(Boolean)
        .join(" ");

      decorations.push(
        Decoration.line({
          class: classNames,
          attributes: {
            "data-markdown-kind": "quote",
            "data-alert-type": alert.alertType,
          },
          wysiwygRecordId: record.id,
          wysiwygRole: "alert-line",
        }).range(curLine.from),
      );
    }

    // 2. 挂载 Marker 与 Widget Replace 装饰
    for (const marker of record.markerRanges) {
      const markerLine = doc.lineAt(marker.from);
      if (markerLine.number === startLine.number) {
        // 首行：始终用 CalloutHeaderWidget 替换首行整行文本（纯视觉只读卡片，绝不展开源码）
        decorations.push(
          Decoration.replace({
            widget: new CalloutHeaderWidget(alert.alertType, alert.title, record.id),
            inclusive: false,
            wysiwygRecordId: record.id,
            wysiwygRole: "alert-header-widget",
          }).range(markerLine.from, markerLine.to),
        );
      } else {
        // 后续行：标准隐藏 `>` 标记（所见即所得模式下不可见）
        const replacement = markerReplacementRange(state, record.kind, marker);
        decorations.push(
          Decoration.replace({
            inclusive: false,
            wysiwygRecordId: record.id,
            wysiwygRole: "quote-marker-hidden",
          }).range(replacement.from, replacement.to),
        );
      }
    }

    return decorations;
  }

  // 普通 Blockquote 或 List / Task
  for (const marker of record.markerRanges) {
    const replacement = markerReplacementRange(state, record.kind, marker);
    if (record.kind === "quote") {
      // 引用块在所见即所得模式下完全隐藏 `>` 标记（由行级左边框与背景提供视觉层次）
      decorations.push(
        Decoration.replace({
          inclusive: false,
          wysiwygRecordId: record.id,
          wysiwygRole: "quote-marker-hidden",
        }).range(replacement.from, replacement.to),
      );
    } else {
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
    }
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
  return getBlockProtectedRanges(record, state).map((range) =>
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: `${record.kind}-marker-atomic`,
    }).range(range.from, range.to),
  );
}

export function getBlockProtectedRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly SourceRange[] {
  if (
    record.parserCoverage !== "complete" ||
    record.renderPolicy !== "marker-hidden" ||
    !isBlockRecord(record)
  ) {
    return [];
  }

  // GFM Alert 首行作为纯视觉只读卡片，整行 [startLine.from, startLine.to] 纳入受保护区间，
  // 禁止误编辑破坏 Alert 语法；后续行正常将其 `>` 标记纳入受保护区间
  if (record.alert) {
    const doc = state.doc;
    const startLine = doc.lineAt(record.fullRange.from);
    const ranges: SourceRange[] = [{ from: startLine.from, to: startLine.to }];

    for (const marker of record.markerRanges) {
      if (doc.lineAt(marker.from).number !== startLine.number) {
        ranges.push(markerReplacementRange(state, record.kind, marker));
      }
    }
    return ranges;
  }

  return record.markerRanges.map((marker) => markerReplacementRange(state, record.kind, marker));
}

export class BlockMarkerWidget extends WidgetType {
  constructor(
    readonly kind: Exclude<BlockRecord["kind"], "quote" | "task">,
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

export function markerReplacementRange(
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
  record: Exclude<BlockRecord, { kind: "quote" | "task" }>,
  marker: SourceRange,
): string {
  if (record.kind === "list-item-unordered") {
    return "•";
  }
  return state.sliceDoc(marker.from, marker.to);
}

function blockLineClass(kind: BlockRecord["kind"]): string {
  return `cm-md-block-line cm-md-block-line--${kind}`;
}
