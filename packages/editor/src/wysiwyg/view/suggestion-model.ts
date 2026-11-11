/**
 * @file wysiwyg/view/suggestion-model.ts
 * @description
 * AI 建议的数据模型与输入规范化：建议项、徽标文案、建议种类与采纳事件。
 * 只依赖 `@codemirror/state`，供状态字段、装饰与宿主接口共用。
 */
import { Annotation, Facet } from "@codemirror/state";

/** 建议种类：`fix` 为错误修正，`style` 为按写作偏好给出的风格统一建议 */
export type AiSuggestionKind = "fix" | "style";

export interface AiSuggestionItem {
  /** 建议种类；缺省视为普通建议（续写或修正），不显示种类标记 */
  readonly kind?: AiSuggestionKind;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export interface AiSuggestionLabels {
  /** `kind="fix"` 的种类标记文案 */
  readonly kindFix?: string;
  /** `kind="style"` 的种类标记文案 */
  readonly kindStyle?: string;
  readonly accept?: string;
  readonly dismiss?: string;
  readonly tabKey?: string;
  readonly escKey?: string;
}

export const DEFAULT_AI_SUGGESTION_LABELS: Required<AiSuggestionLabels> = Object.freeze({
  accept: "接受",
  dismiss: "取消",
  kindFix: "修正",
  kindStyle: "风格",
  tabKey: "Tab",
  escKey: "Esc",
});

export const aiSuggestionLabelsFacet = Facet.define<
  AiSuggestionLabels | undefined,
  Required<AiSuggestionLabels>
>({
  combine: (values) =>
    values.reduce<Required<AiSuggestionLabels>>(
      (acc, val) => (val ? Object.assign(acc, val) : acc),
      { ...DEFAULT_AI_SUGGESTION_LABELS },
    ),
});

export interface AiSuggestionValue {
  readonly items: readonly AiSuggestionItem[];
  readonly activeIndex: number;
  readonly labels?: AiSuggestionLabels;
  /** 视口外建议两阶段 Tab 状态：是否已完成第 1 阶段（平滑定位居中） */
  readonly hasScrolledIntoView?: boolean;
  /** 触发建议时的光标锚点位置（例如 GEC 触发时光标在文末，建议在文首） */
  readonly cursorAnchor?: number;
  // 向后兼容便捷字段（指向当前 active 项）
  readonly from?: number;
  readonly to?: number;
  readonly text?: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export type AiSuggestionInput =
  | AiSuggestionValue
  | AiSuggestionItem
  | readonly AiSuggestionItem[]
  | (Partial<AiSuggestionValue> & AiSuggestionItem);

export function normalizeAiSuggestionValue(
  input: AiSuggestionInput | null | undefined,
): AiSuggestionValue | null {
  if (!input) return null;

  let items: readonly AiSuggestionItem[] = [];
  let activeIndex = 0;

  if (Array.isArray(input)) {
    items = input;
  } else {
    const raw = input as unknown as Record<string, unknown>;
    if ("items" in raw && Array.isArray(raw.items) && raw.items.length > 0) {
      items = raw.items as readonly AiSuggestionItem[];
      activeIndex = Math.min(
        Math.max(0, typeof raw.activeIndex === "number" ? raw.activeIndex : 0),
        items.length - 1,
      );
    } else if (
      typeof raw.from === "number" &&
      typeof raw.to === "number" &&
      typeof raw.text === "string"
    ) {
      items = [raw as unknown as AiSuggestionItem];
    }
  }

  const validItems = items.filter(
    (item) =>
      typeof item.from === "number" &&
      typeof item.to === "number" &&
      item.from <= item.to &&
      typeof item.text === "string" &&
      item.text.length > 0 &&
      (item.originalText === undefined || item.originalText !== item.text),
  );

  if (validItems.length === 0) return null;

  const clampedIndex = Math.min(Math.max(0, activeIndex), validItems.length - 1);
  const active = validItems[clampedIndex];
  const raw = Array.isArray(input) ? null : (input as unknown as Record<string, unknown>);
  const labels = raw?.labels as AiSuggestionLabels | undefined;
  const cursorAnchor = typeof raw?.cursorAnchor === "number" ? raw.cursorAnchor : undefined;
  const hasScrolledIntoView =
    typeof raw?.hasScrolledIntoView === "boolean" ? raw.hasScrolledIntoView : undefined;

  return {
    items: validItems,
    activeIndex: clampedIndex,
    labels,
    cursorAnchor,
    hasScrolledIntoView,
    ...active,
  };
}

/** 用户采纳了一项 AI 建议（插入了文本）时附在事务上的信息 */
export interface AiSuggestionAcceptedEvent {
  readonly from: number;
  /** 采纳前被替换区间的结束位置（续写时等于 from） */
  readonly to: number;
  /** 插入的文本 */
  readonly text: string;
  /** 被替换的原文（续写时为空串） */
  readonly originalText: string;
  readonly kind?: AiSuggestionKind;
}

/** 标记“这次文档变化来自采纳 AI 建议”的事务注解 */
export const aiSuggestionAcceptedAnnotation = Annotation.define<AiSuggestionAcceptedEvent>();
