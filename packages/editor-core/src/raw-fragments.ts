import type { RawFragment, RawFragmentKind, SourceRange } from "./content.ts";

export interface RawFragmentCollectionResult {
  readonly rawMarkdown: string;
  readonly rawFragments: readonly RawFragment[];
}

export class RawFragmentRangeError extends Error {
  constructor(fragment: RawFragment) {
    super(`Raw fragment source range is stale: ${fragment.id}`);
    this.name = "RawFragmentRangeError";
  }
}

export function collectRawFragments(rawMarkdown: string): RawFragmentCollectionResult {
  const rawFragments: RawFragment[] = [];

  collectFrontmatter(rawMarkdown, rawFragments);
  collectLineBlocks(rawMarkdown, rawFragments);
  collectInlineUnknownMdx(rawMarkdown, rawFragments);
  collectInlineMdxExpressions(rawMarkdown, rawFragments);

  return { rawMarkdown, rawFragments: sortFragments(rawFragments) };
}

export function serializeWithRawFragments(
  rawMarkdown: string,
  rawFragments: readonly RawFragment[],
): string {
  return sortFragments(rawFragments).reduceRight((nextMarkdown, fragment) => {
    if (fragment.sourceRange === undefined) {
      return nextMarkdown;
    }

    const currentSource = nextMarkdown.slice(
      fragment.sourceRange.start,
      fragment.sourceRange.end,
    );

    if (currentSource !== fragment.rawSource) {
      throw new RawFragmentRangeError(fragment);
    }

    const replacement = fragment.dirty
      ? fragment.serializedMarkdown ?? fragment.rawSource
      : fragment.rawSource;

    return replaceRange(nextMarkdown, fragment.sourceRange, replacement);
  }, rawMarkdown);
}

function collectFrontmatter(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const match = rawMarkdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);

  if (match === null || match.index !== 0) {
    return;
  }

  rawFragments.push(
    createRawFragment("frontmatter", rawMarkdown, { start: 0, end: match[0].length }),
  );
}

function collectLineBlocks(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const linePattern = /^.*(?:\n|$)/gm;
  const lines = [...rawMarkdown.matchAll(linePattern)].filter((match) => match[0].length > 0);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index];
    const line = match?.[0] ?? "";
    const start = match?.index ?? 0;

    if (isInsideExistingFragment(start, rawFragments)) {
      continue;
    }

    if (isCodeFenceStart(line)) {
      const end = findLineBlockEnd(lines, index, (candidate) =>
        candidate.trimStart().startsWith(line.trimStart().startsWith("~~~") ? "~~~" : "```"),
      );
      rawFragments.push(createRawFragment("codeFence", rawMarkdown, { start, end }));
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    if (isMdxEsmLine(line)) {
      rawFragments.push(
        createRawFragment("mdxEsm", rawMarkdown, { start, end: start + line.length }),
      );
      continue;
    }

    if (isFlowMdxExpression(line)) {
      rawFragments.push(
        createRawFragment("mdxExpression", rawMarkdown, { start, end: start + line.length }),
      );
      continue;
    }

    if (isHtmlBlockStart(line)) {
      const end = findHtmlBlockEnd(lines, index);
      rawFragments.push(createRawFragment("htmlBlock", rawMarkdown, { start, end }));
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    if (isRegisteredCalloutStart(line)) {
      const end = findMdxComponentBlockEnd(lines, index, "Callout");
      rawFragments.push(
        createRawFragment("registeredMdxComponent", rawMarkdown, { start, end }),
      );
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    if (isUnknownMdxFlowStart(line)) {
      rawFragments.push(
        createRawFragment("unknownMdxFlow", rawMarkdown, { start, end: start + line.length }),
      );
    }
  }
}

function collectInlineUnknownMdx(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const inlineComponentPattern = /<[A-Z][A-Za-z0-9]*(?:\s+[^<>]*)?\/?>/g;

  for (const match of rawMarkdown.matchAll(inlineComponentPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (!isInsideExistingFragment(start, rawFragments)) {
      rawFragments.push(createRawFragment("unknownMdxText", rawMarkdown, { start, end }));
    }
  }
}

function collectInlineMdxExpressions(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const inlineExpressionPattern = /\{[^{}\n]+\}/g;

  for (const match of rawMarkdown.matchAll(inlineExpressionPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (!isInsideExistingFragment(start, rawFragments)) {
      rawFragments.push(createRawFragment("mdxExpression", rawMarkdown, { start, end }));
    }
  }
}

function createRawFragment(
  kind: RawFragmentKind,
  rawMarkdown: string,
  sourceRange: SourceRange,
): RawFragment {
  return {
    id: `${kind}-${sourceRange.start}-${sourceRange.end}`,
    kind,
    rawSource: rawMarkdown.slice(sourceRange.start, sourceRange.end),
    sourceRange,
    dirty: false,
  };
}

function sortFragments(rawFragments: readonly RawFragment[]): RawFragment[] {
  return [...rawFragments].sort(
    (left, right) => (left.sourceRange?.start ?? 0) - (right.sourceRange?.start ?? 0),
  );
}

function replaceRange(markdown: string, range: SourceRange, replacement: string): string {
  return `${markdown.slice(0, range.start)}${replacement}${markdown.slice(range.end)}`;
}

function isInsideExistingFragment(offset: number, rawFragments: readonly RawFragment[]): boolean {
  return rawFragments.some((fragment) => {
    const range = fragment.sourceRange;

    return range !== undefined && offset >= range.start && offset < range.end;
  });
}

function isCodeFenceStart(line: string): boolean {
  return /^ {0,3}(```|~~~)/.test(line);
}

function isMdxEsmLine(line: string): boolean {
  return /^\s*(?:import|export)\s+/.test(line);
}

function isFlowMdxExpression(line: string): boolean {
  return /^\s*\{.*}\s*$/.test(line);
}

function isHtmlBlockStart(line: string): boolean {
  return /^\s*<\/?[a-z][A-Za-z0-9-]*(?:\s|>|\/>)/.test(line) || /^\s*<!--/.test(line);
}

function isRegisteredCalloutStart(line: string): boolean {
  return /^\s*<Callout(?:\s|>|\/>)/.test(line);
}

function isUnknownMdxFlowStart(line: string): boolean {
  return /^\s*<\/?[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/.test(line);
}

function findLineBlockEnd(
  lines: readonly RegExpMatchArray[],
  startIndex: number,
  isClosingLine: (line: string) => boolean,
): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.[0] ?? "";

    if (isClosingLine(line)) {
      return (lines[index]?.index ?? 0) + line.length;
    }
  }

  const startMatch = lines[startIndex];

  return (startMatch?.index ?? 0) + (startMatch?.[0].length ?? 0);
}

function findHtmlBlockEnd(lines: readonly RegExpMatchArray[], startIndex: number): number {
  const openingLine = lines[startIndex]?.[0] ?? "";
  const tagName = openingLine.match(/^\s*<([a-z][A-Za-z0-9-]*)/)?.[1];

  if (
    tagName === undefined ||
    openingLine.includes(`</${tagName}>`) ||
    /\/>\s*$/.test(openingLine)
  ) {
    return (lines[startIndex]?.index ?? 0) + openingLine.length;
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.[0] ?? "";

    if (line.includes(`</${tagName}>`)) {
      return (lines[index]?.index ?? 0) + line.length;
    }
  }

  return (lines[startIndex]?.index ?? 0) + openingLine.length;
}

function findMdxComponentBlockEnd(
  lines: readonly RegExpMatchArray[],
  startIndex: number,
  componentName: string,
): number {
  const openingLine = lines[startIndex]?.[0] ?? "";

  if (openingLine.includes(`</${componentName}>`) || /\/>\s*$/.test(openingLine)) {
    return (lines[startIndex]?.index ?? 0) + openingLine.length;
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.[0] ?? "";

    if (line.includes(`</${componentName}>`)) {
      return (lines[index]?.index ?? 0) + line.length;
    }
  }

  return (lines[startIndex]?.index ?? 0) + openingLine.length;
}

function findLineIndexAtOffset(lines: readonly RegExpMatchArray[], offset: number): number {
  const index = lines.findIndex((line) => (line.index ?? 0) >= offset);

  return index === -1 ? lines.length - 1 : Math.max(0, index - 1);
}
