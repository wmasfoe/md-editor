import type { BlockContext, Element, Line, MarkdownConfig } from "@lezer/markdown";
import { MERMAID_NODES } from "./mermaid-types.ts";

/**
 * Lezer Markdown 块级解析器：识别 ```mermaid 与 ~~~mermaid 围栏代码块。
 * 遵循严格的状态机推进，杜绝多行正则，在 FencedCode 之前截获并标记为专属 MermaidBlock 节点。
 */
export const mermaidMarkdownExtension: MarkdownConfig = Object.freeze({
  defineNodes: Object.freeze([
    Object.freeze({ name: MERMAID_NODES.MermaidBlock, block: true }),
    MERMAID_NODES.MermaidMarker,
  ]),
  parseBlock: [
    {
      name: "MermaidBlock",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line) {
        // 1. 缩进代码块（>= 4 空格）不解析
        if (line.indent - line.baseIndent >= 4) {
          return false;
        }

        const text = line.text;
        const pos = line.pos;

        // 2. 检查是否以 3 个及以上的 ``` 或 ~~~ 开头
        const rest = text.slice(pos);
        const fenceMatch = /^(```+|~~~+)/.exec(rest);
        if (!fenceMatch) {
          return false;
        }

        const fence = fenceMatch[1];
        const fenceChar = fence[0];
        const fenceLen = fence.length;

        // 3. 检查语言标识符是否为 "mermaid"（不区分大小写）
        const infoString = rest.slice(fenceLen).trim();
        const infoTokens = infoString.split(/\s+/);
        if (infoTokens[0]?.toLowerCase() !== "mermaid") {
          return false;
        }

        const startPos = cx.lineStart + pos;
        const marks: Element[] = [
          cx.elt(MERMAID_NODES.MermaidMarker, startPos, cx.lineStart + text.length),
        ];

        // 4. 逐行向下推进，寻找对应的闭合 fence
        let closed = false;
        // Lezer 复合块（如 Blockquote / List）内部字段：
        // depth 与 stack 维系当前行所属的复合块深度；markers 携带当前行的引用符号等复合标记。
        // 此处采用可选安全检查，保证解析器在复合块结束时正常退出，且在不同 Lezer 版本下平滑回退。
        const internalLine = line as unknown as { depth?: number; markers?: Element[] };
        const internalCx = cx as unknown as { stack?: unknown[] };

        while (
          cx.nextLine() &&
          (internalLine.depth === undefined ||
            internalCx.stack === undefined ||
            internalLine.depth >= internalCx.stack.length)
        ) {
          if (internalLine.markers) {
            for (const m of internalLine.markers) {
              marks.push(m);
            }
          }
          const curText = line.text;
          const curPos = line.pos;

          if (line.indent - line.baseIndent < 4) {
            const curRest = curText.slice(curPos).trim();
            // 闭合 fence 必须由相同的字符组成且长度至少等于开头的 fence
            if (
              curRest.startsWith(fenceChar) &&
              new RegExp(`^\\${fenceChar}{${fenceLen},}$`).test(curRest)
            ) {
              marks.push(
                cx.elt(
                  MERMAID_NODES.MermaidMarker,
                  cx.lineStart + curPos,
                  cx.lineStart + curText.length,
                ),
              );
              closed = true;
              cx.nextLine();
              break;
            }
          }
        }

        const endPos = closed ? cx.prevLineEnd() : cx.lineStart + line.text.length;
        cx.addElement(cx.elt(MERMAID_NODES.MermaidBlock, startPos, endPos, marks));
        return true;
      },
    },
  ],
});
