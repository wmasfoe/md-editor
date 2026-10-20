import type { Extension } from "@codemirror/state";
import {
  codeBlockEmptyBodyInputHandler,
  codeBlockEmptyBodyPointerHandler,
  codeBlockKeymap,
  provideCodeBlockClipboard,
  type WriteClipboardText,
} from "./editing/code-block-commands.ts";
import {
  codeBlockLineNumbersField,
  codeBlockProjectionTheme,
} from "./projections/code-block-projection.ts";
import { inlineStyleMarkersField } from "./projections/inline-heading.ts";
import { codeBlockLineNumberTheme } from "./editing/code-block-line-numbers.ts";
import { wysiwygChangeProtection } from "./state/change-protection.ts";
import { createMarkdownStructuredCommandExtensions } from "./editing/markdown-commands.ts";
import { createMarkdownFormattingKeymap } from "./editing/markdown-formatting.ts";
import { smartLinkPasteExtension } from "./input/smart-paste.ts";
import { smartPairsExtension } from "./input/smart-pairs.ts";
import { blockAtomTypingInputHandler } from "./blocks/atom-selection.ts";
import { tabArbiterKeymap } from "./input/tab-arbiter-command.ts";
import { focusModeExtension } from "./view/focus-mode.ts";
import { typewriterModeExtension } from "./input/typewriter-mode.ts";
import { markdownParseProgressPlugin } from "./view/parse-progress.ts";
import {
  clearWysiwygTypedBoundaryOnBlur,
  configureWysiwygProjectionFeatures,
  visibleRangesProbePlugin,
  wysiwygProjectionField,
} from "./state/projection-field.ts";
import { type WysiwygProjectionFeature } from "./state/types.ts";
import { htmlProjectionTheme } from "./projections/html-projection.ts";
import { mdxProjectionTheme } from "./projections/mdx-projection.ts";
import { tableProjectionTheme } from "./projections/table-projection.ts";
import { blockReplacementTheme } from "./blocks/block-replacement.ts";
import { visibleMarkdownMarksPlugin } from "./state/visible-marks.ts";

export function createWysiwygProjectionExtensions(
  features: readonly WysiwygProjectionFeature[],
  options: { readonly writeClipboardText?: WriteClipboardText } = {},
): Extension {
  return [
    configureWysiwygProjectionFeatures(features),
    provideCodeBlockClipboard(options.writeClipboardText),
    codeBlockLineNumbersField,
    inlineStyleMarkersField,
    codeBlockLineNumberTheme,
    codeBlockProjectionTheme,
    blockReplacementTheme,
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
    // 按键 order 与 smart-pairs 无关：整块原子选中态下先接管（光标收敛），其余场景返回 false 交回原生路径。
    blockAtomTypingInputHandler,
    // D-2：专注模式 + 打字机模式（纯视图状态，零文档变更）。
    // 两者都是独立 ViewPlugin，不进 layoutDecorations → 不参与 G004 map-vs-rebuild 判定。
    focusModeExtension,
    typewriterModeExtension,
  ];
}

export {
  codeBlockSelectionExtension,
  codeBlockSelectionLayer,
} from "./editing/code-block-selection.ts";
