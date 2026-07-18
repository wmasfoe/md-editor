import {
  GFM,
  type BlockContext,
  type InlineContext,
  type Line,
  type MarkdownConfig,
  type MarkdownExtension,
} from "@lezer/markdown";

const FOOTNOTE_LABEL = "[A-Za-z0-9_-]+";
const INLINE_FOOTNOTE = new RegExp(`^\\[\\^(${FOOTNOTE_LABEL})\\]`, "u");
const FOOTNOTE_DEFINITION = new RegExp(`^\\[\\^(${FOOTNOTE_LABEL})\\]:`, "u");

/**
 * M1 deliberately supports only compact footnote references and one-line
 * definitions. More elaborate continuation syntax stays raw until it has a
 * dedicated editing contract.
 */
export const footnoteMarkdownExtension: MarkdownConfig = Object.freeze({
  defineNodes: Object.freeze([
    Object.freeze({ name: "Footnote", block: false }),
    Object.freeze({ name: "FootnoteDefinition", block: true }),
    "FootnoteMark",
  ]),
  parseInline: Object.freeze([
    Object.freeze({
      name: "Footnote",
      before: "Link",
      parse(cx: InlineContext, next: number, position: number) {
        if (next !== 91 || cx.char(position + 1) !== 94) {
          return -1;
        }
        const match = INLINE_FOOTNOTE.exec(cx.slice(position, cx.end));
        if (!match) {
          return -1;
        }
        const to = position + match[0].length;
        return cx.addElement(
          cx.elt("Footnote", position, to, [cx.elt("FootnoteMark", position, to)]),
        );
      },
    }),
  ]),
  parseBlock: Object.freeze([
    Object.freeze({
      name: "FootnoteDefinition",
      before: "LinkReference",
      parse(cx: BlockContext, line: Line) {
        const source = line.text.slice(line.pos);
        const match = FOOTNOTE_DEFINITION.exec(source);
        if (!match) {
          return false;
        }
        const from = cx.lineStart + line.pos;
        const markerTo = from + match[0].length;
        const to = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(
          cx.elt("FootnoteDefinition", from, to, [cx.elt("FootnoteMark", from, markerTo)]),
        );
        return true;
      },
    }),
  ]),
});

export const M1_MARKDOWN_EXTENSIONS: readonly MarkdownExtension[] = Object.freeze([
  GFM,
  footnoteMarkdownExtension,
]);
