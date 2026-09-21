/**
 * @file code-block-indent.ts
 * @description 围栏代码块的结构性缩进计算：把容器/围栏缩进从代码正文显示中剥离，
 * 并把卡片整体右移到容器内容列，使代码块看起来是列表/任务项的子内容。
 *
 * 规则：
 * - `stripColumns` = 开围栏行的前导空白列数。正文每一行最多隐藏同样多的前导空白；
 *   超出的部分属于代码内容本身，必须原样保留。
 * - `cardInsetColumns` = 仅当围栏位于容器记录（列表项/任务项/引用）内时等于 `stripColumns`，
 *   使卡片左缘对齐容器内容列；顶层缩进围栏只是作者随手缩进，卡片不右移。
 *
 * 该模块同时被投影层（显示）与命令层（复制文本）消费，避免两处各写一份缩进规则。
 */
import type { EditorState } from "@codemirror/state";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";

export interface CodeBlockIndentPlan {
  /** 正文每行最多隐藏的前导空白列数。 */
  readonly stripColumns: number;
  /** 卡片右移列数。 */
  readonly cardInsetColumns: number;
}

/** 零计划：无结构性缩进需要处理。 */
export const EMPTY_CODE_BLOCK_INDENT_PLAN: CodeBlockIndentPlan = Object.freeze({
  stripColumns: 0,
  cardInsetColumns: 0,
});

/** 以缩进表达层级的容器记录种类。 */
const CONTAINER_RECORD_KINDS: ReadonlySet<string> = new Set([
  "list-item-unordered",
  "list-item-ordered",
  "task",
  "quote",
]);

/** 制表位宽度（Markdown 缩进按 4 列计）。 */
const TAB_WIDTH = 4;

/** 计算文本前导空白占用的列数（制表符按制表位推进，空行返回 0）。 */
export function leadingIndentColumns(text: string): number {
  let columns = 0;
  for (const char of text) {
    if (char === " ") {
      columns += 1;
      continue;
    }
    if (char === "\t") {
      columns += TAB_WIDTH - (columns % TAB_WIDTH);
      continue;
    }
    break;
  }
  return columns;
}

/**
 * 解析围栏代码块的缩进计划。
 *
 * 只有「可投影的围栏代码块」才有结构性缩进语义；缩进代码块与不可投影状态返回零计划。
 */
export function resolveCodeBlockIndentPlan(
  record: MarkdownRangeRecord,
  state: EditorState,
): CodeBlockIndentPlan {
  const metadata = record.codeBlock;
  if (
    record.kind !== "deferred-code" ||
    metadata?.blockKind !== "fenced" ||
    !metadata.openingFenceRange
  ) {
    return EMPTY_CODE_BLOCK_INDENT_PLAN;
  }
  const openingLine = state.doc.lineAt(metadata.openingFenceRange.from);
  const stripColumns = leadingIndentColumns(openingLine.text);
  if (stripColumns === 0) {
    return EMPTY_CODE_BLOCK_INDENT_PLAN;
  }
  return Object.freeze({
    stripColumns,
    cardInsetColumns: isLineInsideContainerRecord(state, record.id, openingLine.from)
      ? stripColumns
      : 0,
  });
}

/**
 * 判断某行是否位于容器记录（列表项/任务项/引用）覆盖范围内。
 *
 * 缩进层级由容器承担，而不是围栏自身，这类场景才需要把缩进移到卡片外侧。
 */
function isLineInsideContainerRecord(
  state: EditorState,
  recordId: string,
  lineStart: number,
): boolean {
  const index = state.field(markdownRangeIndexField, false);
  if (!index) {
    return false;
  }
  return index.records.some(
    (candidate) =>
      candidate.id !== recordId &&
      CONTAINER_RECORD_KINDS.has(candidate.kind) &&
      candidate.fullRange.from <= lineStart &&
      candidate.fullRange.to >= lineStart,
  );
}

/**
 * 计算某一行需要隐藏的前导空白范围（不超过 `stripColumns` 列）。
 *
 * 返回值是按字符对齐的源码范围，便于直接构造 replace 装饰；无空白可隐藏时返回 null。
 */
export function resolveHiddenIndentRange(
  state: EditorState,
  lineStart: number,
  stripColumns: number,
): SourceRange | null {
  if (stripColumns <= 0 || lineStart < 0 || lineStart > state.doc.length) {
    return null;
  }
  const line = state.doc.lineAt(Math.min(lineStart, state.doc.length));
  let columns = 0;
  let position = line.from;
  while (position < line.to && columns < stripColumns) {
    const char = line.text[position - line.from];
    if (char === " ") {
      columns += 1;
    } else if (char === "\t") {
      columns += TAB_WIDTH - (columns % TAB_WIDTH);
    } else {
      break;
    }
    position += 1;
  }
  return position > line.from ? Object.freeze({ from: line.from, to: position }) : null;
}

/**
 * 从代码正文文本中按行剥离结构性缩进（工具栏复制使用，保证所见即所得）。
 */
export function stripCodeBlockIndent(text: string, stripColumns: number): string {
  if (stripColumns <= 0 || text.length === 0) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => {
      let columns = 0;
      let index = 0;
      while (index < line.length && columns < stripColumns) {
        const char = line[index];
        if (char === " ") {
          columns += 1;
        } else if (char === "\t") {
          columns += TAB_WIDTH - (columns % TAB_WIDTH);
        } else {
          break;
        }
        index += 1;
      }
      return line.slice(index);
    })
    .join("\n");
}
