/** Layout decoration construction and incremental replacement. */
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { syntaxPluginRegistryFacet, type MarkdownRangeIndex } from "../../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../../markdown/range-types.ts";
import { buildDefaultAtomLayoutDecorations } from "../blocks/default-visualization.ts";
import {
  buildCodeBlockLayoutDecorations,
  codeBlockLineNumbersField,
} from "../projections/code-block-projection.ts";
import { buildFrontmatterLayoutDecorations } from "../projections/frontmatter-projection.ts";
import { buildHtmlLayoutDecorations, isProjectableHtml } from "../projections/html-projection.ts";
import { buildHeadingLayoutDecorations } from "../projections/inline-heading.ts";
import { buildLinkMediaLayoutDecorations } from "../projections/link-projection.ts";
import { buildBlockLayoutDecorations } from "../projections/list-projection.ts";
import { buildMdxLayoutDecorations, isProjectableMdx } from "../projections/mdx-projection.ts";
import {
  buildTableLayoutDecorations,
  isProjectableTable,
} from "../projections/table-projection.ts";
import { configuredProjectionFeatures } from "./types.ts";

export function buildLayoutDecorations(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
  visibleRanges: readonly SourceRange[] = [],
): DecorationSet {
  // G006 P1-4:全量重建时按最近可见区过滤 records——与任一可见区相交即完整
  // 构建(装饰 range 不裁剪,整块 widget 天然不可截断);无可见区信息则全文。
  const records =
    visibleRanges.length > 0
      ? index.records.filter((record) =>
          visibleRanges.some(
            (range) => range.from < record.fullRange.to && record.fullRange.from < range.to,
          ),
        )
      : index.records;
  const ranges = records.flatMap((record) =>
    buildLayoutDecorationsForRecord(
      record,
      activeSyntaxIds,
      selectedAtomIds,
      compositionGuardRanges,
      state,
    ),
  );
  return Decoration.set(ranges, true);
}

export function updateChangedLayoutDecorations(
  previous: DecorationSet,
  index: MarkdownRangeIndex,
  changedIds: readonly string[],
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): DecorationSet {
  const changed = new Set(changedIds);
  const additions = changedIds.flatMap((id) => {
    const record = index.get(id);
    return record
      ? buildLayoutDecorationsForRecord(
          record,
          activeSyntaxIds,
          selectedAtomIds,
          compositionGuardRanges,
          state,
        )
      : [];
  });
  return previous.update({
    filter: (_from, _to, value) => !changed.has(String(value.spec.wysiwygRecordId ?? "")),
    add: additions,
    sort: true,
  });
}

function buildLayoutDecorationsForRecord(
  record: MarkdownRangeRecord,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): readonly Range<Decoration>[] {
  if (
    state.facet(configuredProjectionFeatures).includes("frontmatter") &&
    record.kind === "frontmatter"
  ) {
    return buildFrontmatterLayoutDecorations(record, state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("headings") &&
    (record.kind === "heading-atx" || record.kind === "heading-setext")
  ) {
    return buildHeadingLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      compositionGuardRanges,
    );
  }
  if (
    state.facet(configuredProjectionFeatures).includes("blocks") &&
    (record.kind === "quote" ||
      record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockLayoutDecorations(record, state);
  }
  if (
    state.facet(configuredProjectionFeatures).includes("blocks") &&
    record.kind === "deferred-code"
  ) {
    return buildCodeBlockLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      state.field(codeBlockLineNumbersField),
      state,
    );
  }
  if (state.facet(configuredProjectionFeatures).includes("tables") && isProjectableTable(record)) {
    return buildTableLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      selectedAtomIds.includes(record.id),
      state,
    );
  }
  if (state.facet(configuredProjectionFeatures).includes("html") && isProjectableHtml(record)) {
    return buildHtmlLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (state.facet(configuredProjectionFeatures).includes("mdx") && isProjectableMdx(record)) {
    return buildMdxLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  const pluginRegistry = state.facet(syntaxPluginRegistryFacet);
  const pluginDecorations = pluginRegistry.buildDecorations(record, state, {
    active: activeSyntaxIds.includes(record.id),
    selected: selectedAtomIds.includes(record.id),
  });
  if (pluginDecorations.length > 0) {
    return pluginDecorations;
  }
  if (
    // 裸 URL / 尖括号 autolink：与行内链接同属"链接类"，同样需要走链接渲染
    //（挂 <a href> + .cm-md-link ⇒ 复用单击 reveal / Cmd+点击打开）。此前漏了这条 ⇒
    // link-projection 里的 autolink 分支成了死代码（属主报告"裸 URL 点了没反应"的根因）。
    ((record.kind === "link" || record.kind === "autolink" || record.kind === "reference-link") &&
      state.facet(configuredProjectionFeatures).includes("links")) ||
    (record.kind === "image" && state.facet(configuredProjectionFeatures).includes("images")) ||
    (record.kind === "thematic-break" &&
      state.facet(configuredProjectionFeatures).includes("thematic-breaks"))
  ) {
    return buildLinkMediaLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      selectedAtomIds.includes(record.id),
      state,
    );
  }
  return [];
}
