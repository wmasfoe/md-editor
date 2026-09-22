/**
 * @file bracket-escape-command.ts
 * @description Tab 跳出括号/link 的 **CM6 适配器**（D-1；D-MB 后由统一 Tab arbiter 调度）。
 *
 * ## 位置分流（deep-interview 用户选定的 (c) 方案）
 *
 * > 行首 / 缩进区（或整行选中）→ 归**结构操作**（列表层级等尾动作）
 * > 正文中间 → 归**括号/link 跳出**
 *
 * 两个语义**不抢同一个位置**；若正文中间又无可跳出单元，继续落到尾动作（D2 第 7 步兜底）。
 *
 * ## H4 边界切片（R2 判「绝不能降级」）
 *
 * 判定范围 = **当前行的纯文本 run**，且光标若落在边界 record
 * （frontmatter / HTML 源码 / MDX 源码 / 数学段 / URL 段 / 围栏代码 …）内
 * **一律 fail closed** —— 适配器查 `markdownRangeIndexField` 完成切片与剔除，
 * 把干净的纯文本 run 交给 `detectBracketUnit`（语义单一，签名从类型层面排除视觉坐标）。
 *
 * ## H5 多光标（终局 code-review HIGH：T18）
 *
 * 改用 `state.changeByRange`：**每个折叠光标各自判定、各自跳出**，
 * 无目标的光标原地不动，其余光标与选区**不丢**。
 *
 * ## 既有边界（D3 fail closed）
 * 行内代码 span 由纯函数内部排除；IME 组合期（`view.composing` /
 * `compositionGuardRanges`）一律放行原生（返回 false）。
 */

import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownSyntaxKind } from "../markdown/range-types.ts";
import { detectBracketUnitInLineRuns } from "./bracket-escape.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

/**
 * H4 **fail closed 边界集**：光标位于这些 kind 的 record 覆盖范围内时，
 * 当前行不是「纯文本 run」，不得参与括号配对。
 *
 * - `frontmatter`：M1 一等特性（frontmatter 面板源码）
 * - `html` / `deferred-html`：HTML 源码
 * - `mdx-jsx`：MDX 源码（flow 与 inline JSX）
 * - `directive`：指令源码
 * - `inline-math` / `block-math`：数学段（TeX 括号 `(` 不是可跳出单元）
 * - `deferred-code`：围栏代码体（归 codeBlockTab，永远不该由跳出处理）
 * - `autolink`：URL 段（`<https://x/a(b)>` 里的括号是 URL 字符）
 * - `raw-fallback`：解析回退的原始源码
 */
const CLOSED_BOUNDARY_KINDS: ReadonlySet<MarkdownSyntaxKind> = new Set<MarkdownSyntaxKind>([
  "frontmatter",
  "html",
  "deferred-html",
  "mdx-jsx",
  "directive",
  "inline-math",
  "block-math",
  "deferred-code",
  "autolink",
  "raw-fallback",
]);

/**
 * H4 判定：`position` 是否落在边界 record 覆盖内。
 * 无 range-index（纯 markdown 模式）时返回 false —— 退回行内自守（行内代码等仍由纯函数排除）。
 */
function isClosedBoundarySegment(state: EditorState, position: number): boolean {
  const index = state.field(markdownRangeIndexField, false);
  if (!index) {
    return false;
  }
  return index.records.some(
    (record) =>
      CLOSED_BOUNDARY_KINDS.has(record.kind) &&
      record.fullRange.from <= position &&
      position <= record.fullRange.to,
  );
}

/** H4 集合成员判定（导出供测试断言边界覆盖；数学段解析器在 syntax-plugins 包，由桌面注册） */
export function isTabEscapeClosedKind(kind: MarkdownSyntaxKind): boolean {
  return CLOSED_BOUNDARY_KINDS.has(kind);
}

/** IME / 组合输入护栏：与 `canAcceptAiSuggestion` / `canRunCodeBlockCommand` 同模式 */
function canEscapeBracket(view: EditorView): boolean {
  const projection = view.state.field(wysiwygProjectionField, false);
  return !view.composing && (!projection || projection.compositionGuardRanges.length === 0);
}

/**
 * Tab 跳出括号/link：只移动 selection，**零文本变更**（T20 的实现保证）。
 *
 * 多光标（H5）：全部为折叠光标时逐个判定，有目标者各自跳出，无目标者不动；
 * 任一光标非折叠则交还责任链（与既有单光标门控一致）。
 *
 * @returns 是否发生跳出；false 时由责任链的后续执行器继续仲裁
 */
export function escapeBracket(view: EditorView): boolean {
  if (!canEscapeBracket(view)) {
    return false;
  }
  const { state } = view;
  // 多光标要求全部为折叠光标；含选区时交还责任链（保守门控，与原单光标语义一致）
  if (state.selection.ranges.some((range) => !range.empty)) {
    return false;
  }

  let anyEscaped = false;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    // (c) 位置分流：光标在行首 / 缩进区 → 放行结构尾动作（列表层级）
    if (/^\s*$/.test(state.sliceDoc(line.from, range.from))) {
      return { range };
    }
    // H4：边界 record 内 fail closed（frontmatter/HTML/MDX/数学/URL/代码体…）
    if (isClosedBoundarySegment(state, range.from)) {
      return { range };
    }
    // 判定范围限定当前行的纯文本 run → 跨行/跨块 fail closed；
    // URL 分量由 runs 版切片（HIGH-1：裸 URL 段 fail closed，spec §13 Wikipedia 案）
    const offset = range.from - line.from;
    const unit = detectBracketUnitInLineRuns(line.text, offset);
    if (unit === null) {
      return { range };
    }
    anyEscaped = true;
    // changeByRange 要求真实 SelectionRange 实例（非 spec 对象）
    return { range: EditorSelection.cursor(line.from + unit.to) };
  });

  if (!anyEscaped) {
    return false;
  }
  view.dispatch({
    ...spec,
    scrollIntoView: true,
    userEvent: "select.bracket-escape",
  });
  return true;
}
