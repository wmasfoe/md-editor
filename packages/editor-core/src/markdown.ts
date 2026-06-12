export type MarkdownBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "blockquote"
  | "image"
  | "codeFence"
  | "thematicBreak";

export interface MarkdownBlock {
  readonly type: MarkdownBlockType;
  readonly markdown: string;
}

export interface MarkdownDocument {
  readonly rawMarkdown: string;
  readonly blocks: readonly MarkdownBlock[];
}

export interface MarkdownRoundTripResult {
  readonly document: MarkdownDocument;
  readonly serializedMarkdown: string;
  readonly normalizedEqual: boolean;
}

export function normalizeMarkdownForComparison(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.length === 0 ? "" : `${normalized}\n`;
}

export function parseMarkdownFixture(rawMarkdown: string): MarkdownDocument {
  const normalizedRaw = rawMarkdown.replace(/\r\n?/g, "\n");
  const lines = normalizedRaw.split("\n");
  const blocks: MarkdownBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined || line.trim().length === 0) {
      continue;
    }

    if (isCodeFenceStart(line)) {
      const endIndex = findCodeFenceEnd(lines, index);
      blocks.push({
        type: "codeFence",
        markdown: lines.slice(index, endIndex + 1).join("\n"),
      });
      index = endIndex;
      continue;
    }

    if (/^#{1,6}\s+\S/.test(line)) {
      blocks.push({ type: "heading", markdown: line });
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "thematicBreak", markdown: line });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const endIndex = consumeWhile(lines, index, (candidate) => /^>\s?/.test(candidate));
      blocks.push({ type: "blockquote", markdown: lines.slice(index, endIndex + 1).join("\n") });
      index = endIndex;
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) {
      const endIndex = consumeWhile(lines, index, (candidate) =>
        /^\s*(?:[-*+]|\d+\.)\s+\S/.test(candidate),
      );
      blocks.push({ type: "list", markdown: lines.slice(index, endIndex + 1).join("\n") });
      index = endIndex;
      continue;
    }

    if (/^!\[[^\]]*]\([^)]+\)/.test(line)) {
      blocks.push({ type: "image", markdown: line });
      continue;
    }

    const endIndex = consumeParagraph(lines, index);
    blocks.push({ type: "paragraph", markdown: lines.slice(index, endIndex + 1).join("\n") });
    index = endIndex;
  }

  return { rawMarkdown, blocks };
}

export function serializeMarkdownDocument(document: MarkdownDocument): string {
  return document.rawMarkdown;
}

export function roundTripMarkdownFixture(rawMarkdown: string): MarkdownRoundTripResult {
  const document = parseMarkdownFixture(rawMarkdown);
  const serializedMarkdown = serializeMarkdownDocument(document);

  return {
    document,
    serializedMarkdown,
    normalizedEqual:
      normalizeMarkdownForComparison(rawMarkdown) ===
      normalizeMarkdownForComparison(serializedMarkdown),
  };
}

function isCodeFenceStart(line: string): boolean {
  return /^ {0,3}(```|~~~)/.test(line);
}

function findCodeFenceEnd(lines: readonly string[], startIndex: number): number {
  const openingLine = lines[startIndex] ?? "";
  const marker = openingLine.trimStart().startsWith("~~~") ? "~~~" : "```";

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (line.trimStart().startsWith(marker)) {
      return index;
    }
  }

  return lines.length - 1;
}

function consumeWhile(
  lines: readonly string[],
  startIndex: number,
  predicate: (line: string) => boolean,
): number {
  let index = startIndex;

  while (index + 1 < lines.length && predicate(lines[index + 1] ?? "")) {
    index += 1;
  }

  return index;
}

function consumeParagraph(lines: readonly string[], startIndex: number): number {
  let index = startIndex;

  while (index + 1 < lines.length) {
    const nextLine = lines[index + 1] ?? "";

    if (
      nextLine.trim().length === 0 ||
      isCodeFenceStart(nextLine) ||
      /^#{1,6}\s+\S/.test(nextLine) ||
      /^>\s?/.test(nextLine) ||
      /^\s*(?:[-*+]|\d+\.)\s+\S/.test(nextLine) ||
      /^!\[[^\]]*]\([^)]+\)/.test(nextLine)
    ) {
      break;
    }

    index += 1;
  }

  return index;
}
