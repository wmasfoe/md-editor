import { Facet, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { MdxComponentRegistry } from "@md-editor/mdx-component-registry";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import {
  MdxComponentWidget,
  type MdxComponentWidgetValue,
} from "./widgets/mdx-component-widget.ts";

/** 投影层使用的组件白名单(renderer 配置注入;null = 未配置,一律占位) */
export const mdxComponentRegistryFacet = Facet.define<
  MdxComponentRegistry | null,
  MdxComponentRegistry | null
>({
  combine: (values) => values[values.length - 1] ?? null,
});

/** MDX 组件可投影:mdx-jsx record 且解析完整 */
export function isProjectableMdx(record: MarkdownRangeRecord): boolean {
  return record.kind === "mdx-jsx" && record.parserCoverage === "complete";
}

/** 从 record 还原组件名(record.nodeName 形如 "mdx-jsx:Callout") */
export function mdxComponentName(record: MarkdownRangeRecord): string {
  return record.nodeName.startsWith("mdx-jsx:")
    ? record.nodeName.slice("mdx-jsx:".length)
    : record.nodeName;
}

/**
 * 字符串属性 → 渲染属性。按 M4 协议白名单过滤:
 * 只允许 http/https/mailto/asset/data-image 等安全协议,
 * `javascript:` 等危险协议剔除(与 HTML 白名单同规)。
 */
const SAFE_URI_PROTOCOLS = /^(https?:|mailto:|asset:|data:image\/)/i;

function filterSafeAttributes(
  attributes: readonly { readonly name: string; readonly value: string }[],
): readonly { readonly name: string; readonly value: string }[] {
  return attributes.filter(({ name, value }) => {
    const lower = name.toLowerCase();
    // 事件属性一律剔除(防御纵深;解析层已丢弃表达式,字符串事件属性也拒)
    if (lower.startsWith("on")) {
      return false;
    }
    if (/^(href|src|xlink:href|formaction|action)$/.test(lower) && value.trim() !== "") {
      return SAFE_URI_PROTOCOLS.test(value.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(value.trim());
    }
    return true;
  });
}

export function buildMdxWidgetValue(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): MdxComponentWidgetValue {
  const registry = state.facet(mdxComponentRegistryFacet);
  const componentName = mdxComponentName(record);
  const descriptor = registry?.getByComponentName(componentName)?.component ?? null;
  const source = state.doc.sliceString(record.fullRange.from, record.fullRange.to);
  // 属性来自 record.mdxBlock(解析层已丢弃表达式属性);协议/事件属性在此过滤
  const attributes = filterSafeAttributes(record.mdxBlock?.attributes ?? []);
  // children 预览从 contentRange 提取(渲染为纯文本)
  const childrenSource =
    record.contentRange !== null
      ? state.doc.sliceString(record.contentRange.from, record.contentRange.to)
      : "";
  void source;
  return {
    descriptor,
    componentName,
    attributes,
    childrenSource,
    selected,
  };
}

export function buildMdxLayoutDecorations(
  record: MarkdownRangeRecord,
  selected: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableMdx(record)) {
    return [];
  }
  const value = buildMdxWidgetValue(record, selected, state);
  const replacementTo = trailingLineBreakEnd(record, state);
  return [
    Decoration.replace({
      widget: new MdxComponentWidget(value),
      inclusive: false,
      block: true,
      wysiwygRecordId: record.id,
      wysiwygRole: "mdx-widget",
    }).range(record.fullRange.from, replacementTo),
  ];
}

export function buildMdxAtomicRanges(record: MarkdownRangeRecord): readonly Range<Decoration>[] {
  if (!isProjectableMdx(record)) {
    return [];
  }
  return [
    Decoration.mark({
      wysiwygRecordId: record.id,
      wysiwygRole: "mdx-widget-atomic",
    }).range(record.fullRange.from, record.fullRange.to),
  ];
}

export function getMdxProtectedRanges(record: MarkdownRangeRecord): readonly SourceRange[] {
  return isProjectableMdx(record) ? [record.fullRange] : [];
}

/** 组件块替换为 widget 时,吞掉尾随换行(与 HTML widget 一致) */
function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  const { to } = record.fullRange;
  if (to < state.doc.length && state.doc.sliceString(to, to + 1) === "\n") {
    return to + 1;
  }
  return to;
}

export const mdxProjectionTheme = EditorView.baseTheme({
  ".cm-md-mdx-widget": {
    display: "block",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--theme-border, currentColor)",
    borderRadius: "4px",
    margin: "0.25rem 0",
    background: "var(--theme-surface, transparent)",
  },
  ".cm-md-mdx-widget--selected": {
    outline: "2px solid var(--theme-selection, Highlight)",
    outlineOffset: "2px",
  },
  ".cm-md-mdx-widget__header": {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    fontWeight: "600",
  },
  ".cm-md-mdx-widget__badge": {
    fontSize: "0.75rem",
    padding: "0 0.375rem",
    border: "1px solid currentColor",
    borderRadius: "999px",
    opacity: "0.7",
  },
  ".cm-md-mdx-widget__props": {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0.125rem 0.5rem",
    margin: "0.375rem 0 0",
    fontSize: "0.875rem",
  },
  ".cm-md-mdx-widget__props dt": {
    opacity: "0.6",
  },
  ".cm-md-mdx-widget__props dd": {
    margin: "0",
  },
  ".cm-md-mdx-widget__children": {
    margin: "0.375rem 0 0",
    padding: "0.375rem",
    borderLeft: "2px solid var(--theme-border, currentColor)",
    whiteSpace: "pre-wrap",
    fontSize: "0.875rem",
  },
});
