/**
 * @file tab-arbiter-command.ts
 * @description 统一 Tab arbiter 的 **CM6 薄派发器**（D-MB）。
 *
 * 只做三件事：**建上下文**（从 view/StateField 取布尔事实）、**问纯函数
 * `decideTabActions`** 拿到 D2 全序、**按序调用执行器**直到有一个返回 true。
 * 次序知识不在本文件 —— 那是 `tab-arbiter.ts` 的单一定义点（H3 由构造消失）。
 *
 * 注册为 `Prec.highest` 的**唯一** Tab 绑定（AI / 代码块 / 括号跳出 / 结构化
 * 各自 keymap 中的 Tab 绑定已移除并全部收敛到本调度器）；
 * `Shift-Tab`、`Mod-Enter`、`Escape` 等非 Tab 绑定保持原 keymap 不动。
 */

import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { codeBlockTab } from "./code-block-commands.ts";
import { escapeBracket } from "./bracket-escape-command.ts";
import { structuredTab } from "./markdown-commands.ts";
import { acceptAiSuggestion, aiSuggestionField } from "./suggestion.ts";
import { wysiwygProjectionField } from "./projection-state.ts";
import { dispatchTabActions, type TabAction } from "./tab-arbiter.ts";

/** 执行器表：动作标识 → 实际执行器（全部保留自门控，返回 false 继续序列） */
/** view 闭包版执行器表（轮1 concern-7：映射供给 runner，迭代归 tab-arbiter） */
function executorsFor(view: EditorView): Partial<Record<TabAction, () => boolean>> {
  return {
    "accept-suggestion": () => acceptAiSuggestion(view),
    // 代码块内单元格语义不存在（纯函数已在表格上下文剔除本动作）
    "code-block": () => codeBlockTab(view),
    "escape-bracket": () => escapeBracket(view),
    structured: () => structuredTab(view),
    // CM6 腿不存在跳格语义（表格 DOM keydown 先行拦截，见 I2c + E19 dispatch 级钉子）；防御性恒 false
    "table-next-cell": () => false,
  };
}

/**
 * CM6 腿的上下文构造（接入层：只取事实，不含决策语义）。
 *
 * - `composing`：与 `canEscapeBracket` / `canRunCodeBlockCommand` / `canAcceptAiSuggestion`
 *   同源的双重护栏（`view.composing` + 投影期 `compositionGuardRanges`）。
 * - `inTableCell`：**恒 false** —— 表格单元格 Tab 被 `table-widget.ts` 的 DOM keydown
 *   `stopPropagation` 先行拦截（I2c 实证「任何 Prec 都够不着」），keymap 腿看不到单元格。
 */
function buildTabArbiterContext(view: EditorView): {
  composing: boolean;
  suggestionActive: boolean;
  inTableCell: boolean;
} {
  const projection = view.state.field(wysiwygProjectionField, false);
  return {
    composing: view.composing || (projection?.compositionGuardRanges.length ?? 0) > 0,
    suggestionActive: view.state.field(aiSuggestionField, false) !== null,
    inTableCell: false,
  };
}

/**
 * 统一 Tab 派发：按 D2 全序调用执行器，直到一个返回 true。
 * @returns 是否被消费；false = 交还 CM6（defaultKeymap / 浏览器原生）——
 *   即 **CM6 腿的尾语义**；尾契约全文见 `dispatchTabActions`（tab-arbiter.ts）。
 */
export function runTabArbiter(view: EditorView): boolean {
  // 轮1 concern-7：迭代/序列归共享 runner；本函数只供给 view 闭包映射
  return dispatchTabActions(buildTabArbiterContext(view), executorsFor(view)) === "handled";
}

/** 全编辑器唯一的 Tab 仲裁入口（`Prec.highest`） */
export const tabArbiterKeymap = Prec.highest(keymap.of([{ key: "Tab", run: runTabArbiter }]));
