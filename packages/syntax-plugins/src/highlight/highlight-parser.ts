import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import {
  readDelimiterNeighbors,
  resolveCjkFriendlyDelimiterSides,
} from "@md-editor/renderer-codemirror";
import { HIGHLIGHT_NODES } from "./highlight-types.ts";

const HighlightDelim = { resolve: HIGHLIGHT_NODES.Highlight, mark: HIGHLIGHT_NODES.HighlightMark };

/**
 * Lezer Markdown 扩展：支持 ==高亮== 语法。
 *
 * 遵循 CommonMark / GFM delimiter run 规范与 Typora / Obsidian 事实标准：
 * 1. 定界符为连续的两个等号 `==`；
 * 2. 连续 3 个及以上等号（如 `===`）不解析为双等号高亮（防止侵入标题底线或特殊语法）；
 * 3. 强调边界规则由 `@md-editor/renderer-codemirror` 的 CJK 友好 flanking 判定提供
 *    （与 `**粗体**` / `~~删除~~` 同一套规则）：开定界符后不能紧跟空白，闭定界符前不能紧跟
 *    空白，并支持嵌套强调（如 ==**粗体高亮**==）与中文标点邻接（如 ==「高亮」==）；
 * 4. 转义反斜杠忽略。
 */
export const highlightMarkdownExtension: MarkdownConfig = Object.freeze({
  defineNodes: Object.freeze([
    Object.freeze({ name: HIGHLIGHT_NODES.Highlight }),
    Object.freeze({ name: HIGHLIGHT_NODES.HighlightMark }),
  ]),
  parseInline: Object.freeze([
    Object.freeze({
      name: HIGHLIGHT_NODES.Highlight,
      after: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number) {
        // '=' ASCII 码为 61
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) {
          return -1;
        }

        // 若前置字符是 '\' 则被转义
        if (pos > cx.offset && cx.char(pos - 1) === 92) {
          return -1;
        }

        const sides = resolveCjkFriendlyDelimiterSides(
          "=",
          readDelimiterNeighbors(cx, pos, pos + 2),
        );
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, sides.canOpen, sides.canClose);
      },
    }),
  ]),
});
