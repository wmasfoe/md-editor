/**
 * @file inline-heading.ts
 * @description 行内样式（粗体、斜体、删除线、行内代码）与标题（ATX / Setext）视觉装饰构造器。
 * 支持光标激活时的 `#` 标记隐显控制与输入法合成保护。
 */

import { Facet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { MarkdownRangeRecord, SourceRange } from "../../markdown/range-types.ts";
import { isInlineSourceMarkerKind } from "../state/inline-marker-reveal.ts";

/**
 * 行内标记源码显隐开关的事务 effect。
 *
 * 与 `setCodeBlockLineNumbersEffect` 同构：运行期切换必须走 effect（而非 reconfigure），
 * 否则会重塑 editor state 并引发视图重建抖动。
 */
export const setInlineStyleMarkersEffect = StateEffect.define<boolean>();

/** 初始值 facet（StateField.create 读取；缺省 `false` = 默认不展示源码标记）。 */
export const initialInlineStyleMarkersFacet = Facet.define<boolean, boolean>({
  combine(values) {
    return values.at(-1) ?? false;
  },
});

/** `true` = 四类行内标记的源码符号恒显（改造前行为）；`false` = 仅触及/显形时临时展示。 */
export const inlineStyleMarkersField = StateField.define<boolean>({
  create(state) {
    return state.facet(initialInlineStyleMarkersFacet);
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlineStyleMarkersEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

/** `buildInlineStyleDecorations` 的显隐选项。 */
export interface InlineStyleDecorationOptions {
  /** 该记录当前是否处于“显形”状态（`activeSyntaxIds ∪ inlineMarkerRevealIds`）。 */
  readonly active: boolean;
  /** 开关值：`true` 时四类 marker 恒显（等价改造前行为）。 */
  readonly showSourceMarkers: boolean;
  /** IME 合成保护范围：与 marker 相交时不得折叠，否则输入法会被打断。 */
  readonly compositionGuardRanges: readonly SourceRange[];
}

/**
 * 为行内标记（如 `**粗体**`, `*斜体*`, `` `代码` ``）构建内容与标记样式装饰。
 *
 * 三种形态：
 * 1. 开关 ON（`showSourceMarkers === true`）⇒ 四类 marker 恒显（改造前行为）；
 * 2. 开关 OFF 且该记录已显形（`active`）⇒ marker 可见；
 * 3. 开关 OFF 且未触及 ⇒ 四类 marker 用 `Decoration.replace` 折叠，**但**与
 *    `compositionGuardRanges` 相交的 marker 必须保持可见（IME 合成保护）。
 *
 * 非白名单 kind（`inline-math` / `highlight` / 插件节点）永远走常显路径，不受开关影响。
 */
export function buildInlineStyleDecorations(
  record: MarkdownRangeRecord,
  options: InlineStyleDecorationOptions,
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    record.renderPolicy !== "inline-visible-markers" ||
    !record.contentRange
  ) {
    return [];
  }

  const decorations: Range<Decoration>[] = [
    Decoration.mark({
      class: `cm-md-inline cm-md-${record.kind}`,
      attributes: { "data-markdown-kind": record.kind },
      wysiwygRecordId: record.id,
      wysiwygRole: "inline-content",
    }).range(record.contentRange.from, record.contentRange.to),
  ];
  const collapseMarkers =
    !options.showSourceMarkers && !options.active && isInlineSourceMarkerKind(record.kind);
  for (const marker of record.markerRanges) {
    if (!collapseMarkers || touchesAny(marker, options.compositionGuardRanges)) {
      decorations.push(
        Decoration.mark({
          class: `cm-md-marker cm-md-marker--${record.kind}`,
          attributes: { "data-markdown-marker": record.kind },
          wysiwygRecordId: record.id,
          wysiwygRole: "inline-marker",
        }).range(marker.from, marker.to),
      );
      continue;
    }
    // `inclusive: false` 是 CM6 inline replacement 的默认值，这里显式写出以免误读：
    // 光标可以停留在折叠区两侧（四类 kind 不产 atomic ranges，不会出现方向键整段跳过）。
    decorations.push(
      Decoration.replace({
        inclusive: false,
        wysiwygRecordId: record.id,
        wysiwygRole: "inline-marker-hidden",
        attributes: { "data-markdown-marker-hidden": record.kind },
      }).range(marker.from, marker.to),
    );
  }
  return decorations;
}

export function buildHeadingLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  compositionGuardRanges: readonly SourceRange[],
): readonly Range<Decoration>[] {
  if (
    record.parserCoverage !== "complete" ||
    (record.kind !== "heading-atx" && record.kind !== "heading-setext")
  ) {
    return [];
  }

  const level = headingLevel(record);
  const kindClass = record.kind === "heading-atx" ? "atx" : "setext";
  const decorations: Range<Decoration>[] = [
    Decoration.line({
      class: [
        "cm-md-heading",
        `cm-md-heading--${kindClass}`,
        `cm-md-heading--level-${level}`,
        record.kind === "heading-setext" ? "cm-md-heading--source-only" : "",
      ]
        .filter(Boolean)
        .join(" "),
      attributes: {
        "data-markdown-kind": record.kind,
        "data-heading-level": String(level),
      },
      wysiwygRecordId: record.id,
      wysiwygRole: "heading-line",
    }).range(record.lineRange.from),
  ];

  if (record.kind === "heading-setext") {
    for (const marker of record.markerRanges) {
      decorations.push(visibleHeadingMarker(record, marker, "setext-marker"));
    }
    return decorations;
  }

  const [prefix, ...trailingMarkers] = record.markerRanges;
  if (prefix) {
    const hiddenPrefix = {
      from: prefix.from,
      to: Math.max(prefix.to, record.contentRange?.from ?? prefix.to),
    };
    if (!active && !touchesAny(hiddenPrefix, compositionGuardRanges)) {
      decorations.push(
        Decoration.replace({
          wysiwygRecordId: record.id,
          wysiwygRole: "heading-prefix-hidden",
        }).range(hiddenPrefix.from, hiddenPrefix.to),
      );
    } else {
      decorations.push(visibleHeadingMarker(record, prefix, "heading-prefix-visible"));
    }
  }
  for (const marker of trailingMarkers) {
    decorations.push(visibleHeadingMarker(record, marker, "heading-trailing-marker"));
  }
  return decorations;
}

function visibleHeadingMarker(
  record: MarkdownRangeRecord,
  marker: SourceRange,
  role: string,
): Range<Decoration> {
  return Decoration.mark({
    class: `cm-md-marker cm-md-marker--${record.kind}`,
    attributes: { "data-markdown-marker": record.kind },
    wysiwygRecordId: record.id,
    wysiwygRole: role,
  }).range(marker.from, marker.to);
}

function headingLevel(record: MarkdownRangeRecord): number {
  const match = /(?:ATXHeading|SetextHeading)([1-6])/u.exec(record.nodeName);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function touchesAny(range: SourceRange, candidates: readonly SourceRange[]): boolean {
  return candidates.some((candidate) =>
    candidate.from === candidate.to
      ? candidate.from >= range.from && candidate.from <= range.to
      : candidate.from < range.to && candidate.to > range.from,
  );
}
