import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

export const DIRECTIVE_NODES = {
  ContainerDirective: "ContainerDirective",
  DirectiveMarker: "DirectiveMarker",
  DirectiveType: "DirectiveType",
  DirectiveTitle: "DirectiveTitle",
} as const;

/**
 * 遵循 Lezer Markdown 官方 BlockParser 规范的容器指令解析器。
 * 纯状态机逐行推进，杜绝跨行正则，感知内部代码块嵌套与缩进。
 */
export const directiveMarkdownExtension: MarkdownConfig = Object.freeze({
  defineNodes: Object.freeze([
    Object.freeze({ name: DIRECTIVE_NODES.ContainerDirective, block: true }),
    DIRECTIVE_NODES.DirectiveMarker,
    DIRECTIVE_NODES.DirectiveType,
    DIRECTIVE_NODES.DirectiveTitle,
  ]),
  parseBlock: [
    {
      name: "ContainerDirective",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line) {
        // 1. 缩进代码块（>= 4 空格）不解析
        if (line.indent - line.baseIndent >= 4) {
          return false;
        }

        const text = line.text;
        let pos = line.pos;

        // 2. 必须以 ::: 开头（字符码 58 为 ':'）
        if (
          pos + 3 > text.length ||
          text.charCodeAt(pos) !== 58 ||
          text.charCodeAt(pos + 1) !== 58 ||
          text.charCodeAt(pos + 2) !== 58
        ) {
          return false;
        }

        const startPos = cx.lineStart + pos;
        const markerEnd = pos + 3;
        pos += 3;

        // 3. 状态机提取 directiveType 标识符（英文字母、数字、下划线、中划线）
        const typeStart = pos;
        while (pos < text.length && /[a-zA-Z0-9_-]/.test(text[pos])) {
          pos++;
        }
        if (pos === typeStart) {
          // ::: 后面无类型标识符（如单独的一行 :::），不是容器起始行，安全放弃
          return false;
        }
        const typeEnd = pos;

        // 4. 跳过水平空格提取可选标题 title
        while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) {
          pos++;
        }
        const titleStart = pos;
        const titleEnd = text.length;

        const marks = [
          cx.elt(DIRECTIVE_NODES.DirectiveMarker, startPos, cx.lineStart + markerEnd),
          cx.elt(DIRECTIVE_NODES.DirectiveType, cx.lineStart + typeStart, cx.lineStart + typeEnd),
        ];
        if (titleEnd > titleStart) {
          marks.push(
            cx.elt(
              DIRECTIVE_NODES.DirectiveTitle,
              cx.lineStart + titleStart,
              cx.lineStart + titleEnd,
            ),
          );
        }

        // 5. 逐行向下推进，检测内部代码块与闭合行
        let closed = false;
        let insideCodeFence = false;
        let fenceChar = "";
        let fenceLen = 0;

        while (cx.nextLine()) {
          const curText = line.text;
          const curPos = line.pos;

          // 追踪内部代码块，防止代码块内的 ::: 错误闭合外部容器
          if (line.indent - line.baseIndent < 4) {
            const rest = curText.slice(curPos);
            const fenceMatch = /^(```+|~~~+)/.exec(rest);
            if (fenceMatch) {
              const char = fenceMatch[1][0];
              const len = fenceMatch[1].length;
              if (!insideCodeFence) {
                insideCodeFence = true;
                fenceChar = char;
                fenceLen = len;
              } else if (char === fenceChar && len >= fenceLen) {
                insideCodeFence = false;
              }
            }
          }

          // 不在代码块内时，检测闭合 :::
          if (!insideCodeFence && line.indent - line.baseIndent < 4) {
            const rest = curText.slice(curPos).trim();
            if (rest === ":::") {
              marks.push(
                cx.elt(
                  DIRECTIVE_NODES.DirectiveMarker,
                  cx.lineStart + curPos,
                  cx.lineStart + curPos + 3,
                ),
              );
              closed = true;
              cx.nextLine();
              break;
            }
          }
        }

        // 6. 生成完整 AST 节点；若未闭合则吞到当前块结尾
        const endPos = closed ? cx.prevLineEnd() : cx.lineStart + line.text.length;
        cx.addElement(cx.elt(DIRECTIVE_NODES.ContainerDirective, startPos, endPos, marks));
        return true;
      },
    },
  ],
});
