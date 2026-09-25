/**
 * @fileoverview 行级缩进：Tab 缩进 / Shift-Tab 反缩进的**唯一实现**。
 *
 * ## 为什么独立成模块
 *
 * 两个入口都要用它：CM6 的 Tab 仲裁兜底（`tab-arbiter-command.ts`）与 Shift-Tab 绑定
 * （`markdown-commands.ts`）。若写在仲裁器里，`markdown-commands.ts` 就要反向导入它 ——
 * 而仲裁器已经从 `markdown-commands.ts` 导入 `structuredTab` ⇒ 会形成**循环导入**。
 * 故把「文本级缩进」这一件事收敛到本模块，两个入口各自单向依赖它。
 *
 * ## 语义（属主手测驱动）
 *
 * - **两个编辑轴一致**：源码模式本来就有行级缩进；所见即所得模式此前把 Tab **交还浏览器**
 *   ⇒ 普通正文既无缩进、DOM 焦点又被 Tab 导航送出编辑器（实测 `activeElement` 落到 `BODY`）。
 *   缩进是**文本级**语义（与编辑轴无关），故合一。
 * - **缩进单位 2 空格**（与代码块缩进约定一致）：刻意不用 4 空格 —— 4 空格在 markdown 里
 *   会把段落变成缩进代码块。
 * - **保护优先（fail-closed）**：变更前先问保护层 `isWysiwygChangeAllowed`（与
 *   `change-protection` **同一判据**，不自创门控）。受保护语义（frontmatter 的 YAML 结构、
 *   HTML/MDX 块、围栏代码体等）下**只消费按键、不动文本** —— 给这些行加行首空格会改变文档含义。
 * - **自己消费按键**：即使无法缩进/反缩进，也返回 `true`，不让焦点离开编辑器。
 * - 列表层级、代码块缩进等更强语义由仲裁器全序在**本兜底之前**处理，互不影响。
 */

import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isWysiwygChangeAllowed } from "./change-protection.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";

/** 行级缩进单位：2 空格（与代码块缩进约定一致且不会产生缩进代码块） */
export const INDENT_UNIT = "  ";

/**
 * 执行缩进事务，但**先问保护层**是否允许。
 *
 * - 允许 ⇒ 落盘（走 `view.dispatch`，保留 `userEvent` 以便撤销栈与既有惯例一致）；
 * - 不允许 ⇒ **不动文本**，只返回 `true` 消费该按键（fail-closed，且焦点留在编辑器内）。
 */
function applyIndentTransaction(view: EditorView, spec: TransactionSpec): boolean {
  const transaction = view.state.update(spec);
  if (!isWysiwygChangeAllowed(transaction)) {
    return true; // 保护层拒绝：只消费按键、不动文本
  }
  if (!coveringRecordIsIndentable(view.state, view.state.selection.main.head)) {
    // 记录自身声明「仅源码模式可编辑」（frontmatter / HTML / MDX 等）⇒ 同样不动文本。
    // 注意：这是与保护层**并用**而非替代 —— 保护层判的是「变更范围是否落在受保护区间」，
    // 而 frontmatter 的保护区不覆盖行首边界，仅靠保护层会放行行首缩进（实测）。
    return true;
  }
  view.dispatch(transaction);
  return true;
}

/**
 * **行级缩进的适用范围**：块级语义不接受行首缩进。
 *
 * 理由：在 frontmatter 行加行首空格会破坏 YAML 结构，HTML/MDX 块同理；引用定义/脚注/表格/
 * 分隔线等也属结构性内容。这些位置 Tab **只消费按键、不动文本**（focus 仍留在编辑器内）。
 * 说明：这是「行级缩进功能自身的适用范围」规则，**不是**在替代保护层 —— 保护层仍照常
 * 由 `isWysiwygChangeAllowed` 判定（两者并用）。
 */
const BLOCK_LEVEL_KINDS: ReadonlySet<string> = new Set([
  "frontmatter",
  "html",
  "mdx",
  "mdx-jsx",
  "reference-definition",
  "footnote",
  "table",
  "thematic-break",
  "deferred-code",
  "code-block",
]);

/** 光标所在记录是否允许行级缩进（记录自身的 editPolicy + 块级语义白/黑名单） */
function coveringRecordIsIndentable(state: EditorState, pos: number): boolean {
  const index = state.field(markdownRangeIndexField, false);
  if (!index) {
    return true;
  }
  const covering = index.records.find(
    (record) => record.fullRange.from <= pos && pos <= record.fullRange.to,
  );
  if (!covering) {
    return true; // 纯正文行：没有覆盖记录
  }
  // 只按**块级 kind** 拒绝：早先还加了 `editPolicy === "source-mode-only"` 条件，
  // 实测会把**普通段落**也拒掉（段落记录带该策略）⇒ 属过度拒绝，已移除。
  return !BLOCK_LEVEL_KINDS.has(covering.kind);
}

/** Tab 兜底：在光标所在行行首插入缩进单位；光标随插入量右移，保持相对位置 */
export function insertIndent(view: EditorView): boolean {
  const { state } = view;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    return {
      changes: { from: line.from, insert: INDENT_UNIT },
      range: EditorSelection.cursor(range.from + INDENT_UNIT.length),
    };
  });
  return applyIndentTransaction(view, {
    ...spec,
    userEvent: "input.indent",
    scrollIntoView: true,
  });
}

/**
 * Shift-Tab 兜底：移除行首最多一个缩进单位，与 `insertIndent` 对称。
 *
 * 调用点在 `outdentMarkdownList` **之后** ⇒ 列表层级不受影响（列表先被结构命令消费）。
 */
export function removeIndent(view: EditorView): boolean {
  const { state } = view;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const leading = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    if (leading.length === 0) {
      return { range };
    }
    const removed = leading.slice(0, INDENT_UNIT.length);
    return {
      changes: { from: line.from, to: line.from + removed.length, insert: "" },
      range: EditorSelection.cursor(Math.max(line.from, range.from - removed.length)),
    };
  });
  if (spec.changes.empty) {
    return true; // 无可反缩进：仍消费按键（焦点不离开编辑器）
  }
  return applyIndentTransaction(view, {
    ...spec,
    userEvent: "input.indent",
    scrollIntoView: true,
  });
}
