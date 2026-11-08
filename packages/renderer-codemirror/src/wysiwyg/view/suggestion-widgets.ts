/**
 * @file wysiwyg/view/suggestion-widgets.ts
 * @description
 * AI 建议的行内 DOM 部件：幽灵续写文本、修改差异与操作徽标。
 */
import { WidgetType, type EditorView } from "@codemirror/view";
import {
  DEFAULT_AI_SUGGESTION_LABELS,
  type AiSuggestionKind,
  type AiSuggestionLabels,
} from "./suggestion-model.ts";

const areLabelsEq = (a?: AiSuggestionLabels, b?: AiSuggestionLabels): boolean =>
  a === b ||
  (a?.accept === b?.accept &&
    a?.dismiss === b?.dismiss &&
    a?.tabKey === b?.tabKey &&
    a?.escKey === b?.escKey &&
    a?.kindFix === b?.kindFix &&
    a?.kindStyle === b?.kindStyle);

export function createAiBadge(
  doc: Document,
  labels: Required<AiSuggestionLabels>,
  step = "",
  kind?: AiSuggestionKind,
): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "cm-md-ai-badge";
  badge.setAttribute("aria-hidden", "true");
  const actions = `${labels.tabKey} ${labels.accept}${step} · ${labels.escKey} ${labels.dismiss}`;
  const kindLabel = kind === "fix" ? labels.kindFix : kind === "style" ? labels.kindStyle : "";
  if (kindLabel) {
    badge.dataset.kind = kind;
  }
  badge.textContent = kindLabel ? `${kindLabel} · ${actions}` : actions;
  return badge;
}

export class GhostTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly labels?: Required<AiSuggestionLabels>,
  ) {
    super();
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text && areLabelsEq(other.labels, this.labels);
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return null as never;
    const span = doc.createElement("span");
    span.className = "cm-md-ai-ghost-text";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    span.append(createAiBadge(doc, this.labels ?? DEFAULT_AI_SUGGESTION_LABELS));
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class DiffAdditionWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly options: {
      readonly isActive: boolean;
      readonly stepLabel?: string;
      readonly labels?: Required<AiSuggestionLabels>;
      readonly kind?: AiSuggestionKind;
    } = {
      isActive: true,
    },
  ) {
    super();
  }

  eq(other: DiffAdditionWidget): boolean {
    return (
      other.text === this.text &&
      other.options.isActive === this.options.isActive &&
      other.options.stepLabel === this.options.stepLabel &&
      other.options.kind === this.options.kind &&
      areLabelsEq(other.options.labels, this.options.labels)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return null as never;
    const span = doc.createElement("span");
    span.className = this.options.isActive
      ? "cm-md-ai-diff-added"
      : "cm-md-ai-diff-added cm-md-ai-diff-pending";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    if (this.options.isActive) {
      span.append(
        createAiBadge(
          doc,
          this.options.labels ?? DEFAULT_AI_SUGGESTION_LABELS,
          this.options.stepLabel || "",
          this.options.kind,
        ),
      );
    }
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
