import type { Extension } from "@codemirror/state";
import {
  codeBlockEmptyBodyInputHandler,
  codeBlockEmptyBodyPointerHandler,
  codeBlockKeymap,
  provideCodeBlockClipboard,
  type WriteClipboardText,
} from "./code-block-commands.ts";
import { codeBlockLineNumbersField, codeBlockProjectionTheme } from "./code-block-projection.ts";
import { codeBlockLineNumberTheme } from "./code-block-line-numbers.ts";
import { wysiwygChangeProtection } from "./change-protection.ts";
import { createMarkdownStructuredCommandExtensions } from "./markdown-commands.ts";
import { createMarkdownFormattingKeymap } from "./markdown-formatting.ts";
import { smartLinkPasteExtension } from "./smart-paste.ts";
import { smartPairsExtension } from "./smart-pairs.ts";
import { tabArbiterKeymap } from "./tab-arbiter-command.ts";
import { focusModeExtension } from "./focus-mode.ts";
import { typewriterModeExtension } from "./typewriter-mode.ts";
import { markdownParseProgressPlugin } from "./parse-progress.ts";
import {
  clearWysiwygTypedBoundaryOnBlur,
  configureWysiwygProjectionFeatures,
  visibleRangesProbePlugin,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import { htmlProjectionTheme } from "./html-projection.ts";
import { mdxProjectionTheme } from "./mdx-projection.ts";
import { tableProjectionTheme } from "./table-projection.ts";
import { visibleMarkdownMarksPlugin } from "./visible-marks.ts";

export function createWysiwygProjectionExtensions(
  features: readonly WysiwygProjectionFeature[],
  options: { readonly writeClipboardText?: WriteClipboardText } = {},
): Extension {
  return [
    configureWysiwygProjectionFeatures(features),
    provideCodeBlockClipboard(options.writeClipboardText),
    codeBlockLineNumbersField,
    codeBlockLineNumberTheme,
    codeBlockProjectionTheme,
    tableProjectionTheme,
    htmlProjectionTheme,
    mdxProjectionTheme,
    wysiwygProjectionField,
    clearWysiwygTypedBoundaryOnBlur,
    visibleRangesProbePlugin,
    visibleMarkdownMarksPlugin,
    wysiwygChangeProtection,
    markdownParseProgressPlugin,
    codeBlockEmptyBodyInputHandler,
    codeBlockEmptyBodyPointerHandler,
    // 代码块非 Tab 键位（Enter/Shift-Tab/Backspace/Delete/Mod-a）仍归本 keymap；
    // 其 **Tab 绑定已移除**，收敛到下方统一 arbiter（D-MB）。
    codeBlockKeymap,
    // D-MB：统一 Tab arbiter —— 全编辑器**唯一** Prec.highest Tab 绑定。
    // AI 接受 / 代码块缩进 / 括号跳出 / 结构尾动作的次序由纯决策函数
    // （tab-arbiter.ts 的 decideTabActions）单一定义；各执行器保留自门控。
    // H3（数组位置≠派发顺序）由构造消失：本数组里不再存在第二个 Tab 绑定。
    tabArbiterKeymap,
    createMarkdownStructuredCommandExtensions(),
    createMarkdownFormattingKeymap(),
    smartLinkPasteExtension,
    smartPairsExtension,
    // D-2：专注模式 + 打字机模式（纯视图状态，零文档变更）。
    // 两者都是独立 ViewPlugin，不进 layoutDecorations → 不参与 G004 map-vs-rebuild 判定。
    focusModeExtension,
    typewriterModeExtension,
  ];
}

export { codeBlockSelectionExtension, codeBlockSelectionLayer } from "./code-block-selection.ts";
