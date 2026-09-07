import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";
import { MATH_NODES } from "./math-types.ts";

/**
 * Lezer Markdown 扩展：支持 LaTeX 行内公式（$math$）与独立块公式（$$math$$）。
 *
 * 遵循 CommonMark / GFM 事实标准与 remark-math 防误触规则：
 * 1. 行内公式：
 *    - 起始 $ 后面不能紧跟空格或换行；
 *    - 闭合 $ 前面不能是空格或换行，且后面不能紧跟数字（防止 $100 and $200 货币误判）；
 *    - 转义的 \$ 安全忽略。
 * 2. 块级公式：
 *    - 支持单行 $$...$$ 与多行跨行公式块；
 *    - 缩进代码块（>= 4 空格）不解析。
 */
export const mathMarkdownExtension: MarkdownConfig = Object.freeze({
  defineNodes: Object.freeze([
    Object.freeze({ name: MATH_NODES.BlockMath, block: true }),
    Object.freeze({ name: MATH_NODES.InlineMath }),
    MATH_NODES.MathMark,
  ]),
  parseBlock: [
    {
      name: "BlockMath",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line) {
        // 1. 缩进代码块（>= 4 空格）不解析
        if (line.indent - line.baseIndent >= 4) {
          return false;
        }

        const text = line.text;
        const pos = line.pos;

        // 2. 必须以 $$ 开头（字符码 36 为 '$'）
        if (
          pos + 2 > text.length ||
          text.charCodeAt(pos) !== 36 ||
          text.charCodeAt(pos + 1) !== 36
        ) {
          return false;
        }

        const startPos = cx.lineStart + pos;

        // 3. 检查是否在同一行闭合（单行独立块公式，如 $$E=mc^2$$）
        const restOfLine = text.slice(pos + 2);
        const closeIndexInRest = restOfLine.indexOf("$$");

        if (closeIndexInRest !== -1) {
          const closePos = pos + 2 + closeIndexInRest;
          const endPos = cx.lineStart + closePos + 2;
          const marks = [
            cx.elt(MATH_NODES.MathMark, startPos, startPos + 2),
            cx.elt(MATH_NODES.MathMark, cx.lineStart + closePos, endPos),
          ];
          cx.nextLine();
          cx.addElement(cx.elt(MATH_NODES.BlockMath, startPos, endPos, marks));
          return true;
        }

        // 4. 多行公式块：逐行推进直到找到闭合 $$ 或文档结尾
        const marks = [cx.elt(MATH_NODES.MathMark, startPos, startPos + 2)];
        let closed = false;

        while (cx.nextLine()) {
          const curText = line.text;
          const curPos = line.pos;

          if (line.indent - line.baseIndent < 4) {
            const closeIndex = curText.indexOf("$$", curPos);
            if (closeIndex !== -1) {
              marks.push(
                cx.elt(
                  MATH_NODES.MathMark,
                  cx.lineStart + closeIndex,
                  cx.lineStart + closeIndex + 2,
                ),
              );
              closed = true;
              cx.nextLine();
              break;
            }
          }
        }

        const endPos = closed ? cx.prevLineEnd() : cx.lineStart + line.text.length;
        cx.addElement(cx.elt(MATH_NODES.BlockMath, startPos, endPos, marks));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Escape",
      parse(cx: InlineContext, next: number, pos: number) {
        // 必须以 $ 开头（字符码 36 为 '$'）
        if (next !== 36) {
          return -1;
        }

        // 检查前置字符是否为转义反斜杠 '\'（ASCII 92）
        if (pos > cx.offset && cx.char(pos - 1) === 92) {
          return -1;
        }

        // 检查是否为双 $$（行内 display math，如 $$x^2$$）
        if (cx.char(pos + 1) === 36) {
          const nextChar = cx.char(pos + 2);
          // $$ 紧跟空白字符时不作为有效公式开头
          if (nextChar <= 32 || nextChar === 36) {
            return -1;
          }
          // 在当前行内寻找匹配的闭合 $$
          let searchPos = pos + 2;
          while (searchPos < cx.end) {
            const ch = cx.char(searchPos);
            if (ch === 10 || ch === 13) {
              break; // 行内解析不跨行
            }
            if (ch === 36 && cx.char(searchPos + 1) === 36 && cx.char(searchPos - 1) !== 92) {
              const prevChar = cx.char(searchPos - 1);
              if (prevChar > 32) {
                const endPos = searchPos + 2;
                const marks = [
                  cx.elt(MATH_NODES.MathMark, pos, pos + 2),
                  cx.elt(MATH_NODES.MathMark, searchPos, endPos),
                ];
                cx.addElement(cx.elt(MATH_NODES.BlockMath, pos, endPos, marks));
                return endPos;
              }
            }
            searchPos++;
          }
          return -1;
        }

        // 单 $ 行内公式：
        // 1. $ 之后不能是空格、制表符、换行或另一个 $
        const afterOpen = cx.char(pos + 1);
        if (afterOpen <= 32 || afterOpen === 36 || afterOpen === -1) {
          return -1;
        }

        // 2. 扫描寻找匹配的闭合 $
        let i = pos + 1;
        while (i < cx.end) {
          const ch = cx.char(i);
          // 遇到换行，中止行内匹配
          if (ch === 10 || ch === 13) {
            return -1;
          }

          if (ch === 36 && cx.char(i - 1) !== 92) {
            const beforeClose = cx.char(i - 1);
            // 闭合 $ 之前不能是空白字符
            if (beforeClose <= 32) {
              return -1;
            }

            // 闭合 $ 之后不能紧跟数字（防 $100 and $200 货币误触）
            const afterClose = cx.char(i + 1);
            if (afterClose >= 48 && afterClose <= 57) {
              i++;
              continue;
            }

            // 匹配成功！
            const endPos = i + 1;
            const marks = [
              cx.elt(MATH_NODES.MathMark, pos, pos + 1),
              cx.elt(MATH_NODES.MathMark, i, endPos),
            ];
            cx.addElement(cx.elt(MATH_NODES.InlineMath, pos, endPos, marks));
            return endPos;
          }
          i++;
        }

        return -1;
      },
    },
  ],
});
