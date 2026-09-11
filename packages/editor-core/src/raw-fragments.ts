/**
 * @fileoverview Markdown 保真语法切片收集器与序列化器 (Raw Fragments)
 *
 * 在富文本编辑器中，为了对 Frontmatter、代码块 (CodeFence)、原生 HTML 块、MDX 标签及
 * 行内 MDX 表达式实现绝对字符级保真（Round-Trip Fidelity），本模块负责：
 * 1. 扫描原始 Markdown 文本中的特殊语法结构，捕获其在源文本中的绝对字节/字符区间 (SourceRange)。
 * 2. 标记未修改切片 (Clean Fragment) 与已脏化切片 (Dirty Fragment)。
 * 3. 反写序列化时，优先原样保留未被用户篡改的切片文本，精确保护空格、缩进及空行边界。
 */

import type { RawFragment, RawFragmentKind, SourceRange } from "./content.ts";

/**
 * 语法切片收集结果
 */
export interface RawFragmentCollectionResult {
  /** 原始 Markdown 文本 */
  readonly rawMarkdown: string;
  /** 从源文本中提取出的有序切片列表 */
  readonly rawFragments: readonly RawFragment[];
}

/**
 * 语法切片源范围陈旧异常
 * 当反写时发现切片记录的源范围内容与当前文本不匹配时抛出，防止脏写破坏文档
 */
export class RawFragmentRangeError extends Error {
  constructor(fragment: RawFragment) {
    super(`Raw fragment source range is stale: ${fragment.id}`);
    this.name = "RawFragmentRangeError";
  }
}

/**
 * 从原始 Markdown 文本中提取所有保真切片
 *
 * 按照语法优先级依次收集：
 * 1. YAML Frontmatter（必须位于文档最开头）
 * 2. 块级结构（代码块、MDX ESM 语句、MDX 流式表达式、HTML 块、已注册的 Callout 组件）
 * 3. 行内 MDX 组件标签 (<Component ... />)
 * 4. 行内 MDX 表达式 ({...})
 *
 * @param rawMarkdown 原始输入 Markdown 字符串
 * @returns 包含已按起始位置升序排序的切片集合
 */
export function collectRawFragments(rawMarkdown: string): RawFragmentCollectionResult {
  const rawFragments: RawFragment[] = [];

  collectFrontmatter(rawMarkdown, rawFragments);
  collectLineBlocks(rawMarkdown, rawFragments);
  collectInlineUnknownMdx(rawMarkdown, rawFragments);
  collectInlineMdxExpressions(rawMarkdown, rawFragments);

  return { rawMarkdown, rawFragments: sortFragments(rawFragments) };
}

/**
 * 将保真切片反写回 Markdown 文本
 *
 * 从后往前 (reduceRight) 倒序替换文本区间，保证前面切片的偏移量不受后续文本长度改变的影响。
 *
 * @param rawMarkdown 基础 Markdown 文本
 * @param rawFragments 切片集合
 * @returns 序列化合并后的 Markdown 文本
 */
export function serializeWithRawFragments(
  rawMarkdown: string,
  rawFragments: readonly RawFragment[],
): string {
  return sortFragments(rawFragments).reduceRight((nextMarkdown, fragment) => {
    if (fragment.sourceRange === undefined) {
      return nextMarkdown;
    }

    const currentSource = nextMarkdown.slice(fragment.sourceRange.start, fragment.sourceRange.end);

    // 校验源范围是否发生脱节
    if (currentSource !== fragment.rawSource) {
      throw new RawFragmentRangeError(fragment);
    }

    // 若切片被用户在编辑器中修改过，则应用序列化后的新文本并保护尾部换行
    const replacement = fragment.dirty
      ? preserveRawFragmentLineBoundary(
          fragment.rawSource,
          fragment.serializedMarkdown ?? fragment.rawSource,
        )
      : fragment.rawSource;

    return replaceRange(nextMarkdown, fragment.sourceRange, replacement);
  }, rawMarkdown);
}

/**
 * 收集文档顶部的 YAML Frontmatter 切片
 * 匹配以 --- 开头并以 --- 结尾的头部元数据块
 */
function collectFrontmatter(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const match = rawMarkdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);

  if (match === null || match.index !== 0) {
    return;
  }

  rawFragments.push(
    createRawFragment("frontmatter", rawMarkdown, { start: 0, end: match[0].length }),
  );
}

/**
 * 按行扫描并提取各类块级语法切片
 */
function collectLineBlocks(rawMarkdown: string, rawFragments: RawFragment[]): void {
  const linePattern = /^.*(?:\n|$)/gm;
  const lines = [...rawMarkdown.matchAll(linePattern)].filter((match) => match[0].length > 0);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index];
    const line = match?.[0] ?? "";
    const start = match?.index ?? 0;

    // 若当前行偏移量已落在先前已捕获的切片内，则跳过
    if (isInsideExistingFragment(start, rawFragments)) {
      continue;
    }

    // 1. 代码块围栏 (``` 或 ~~~)
    if (isCodeFenceStart(line)) {
      const end = findLineBlockEnd(lines, index, (candidate) =>
        candidate.trimStart().startsWith(line.trimStart().startsWith("~~~") ? "~~~" : "```"),
      );
      rawFragments.push(createRawFragment("codeFence", rawMarkdown, { start, end }));
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    // 2. MDX ESM 语句 (import / export)
    if (isMdxEsmLine(line)) {
      rawFragments.push(
        createRawFragment("mdxEsm", rawMarkdown, { start, end: start + line.length }),
      );
      continue;
    }

    // 3. 独立行的 MDX 表达式 ({...})
    if (isFlowMdxExpression(line)) {
      rawFragments.push(
        createRawFragment("mdxExpression", rawMarkdown, { start, end: start + line.length }),
      );
      continue;
    }

    // 4. 原生 HTML 块级标签
    if (isHtmlBlockStart(line)) {
      const end = findHtmlBlockEnd(lines, index);
      rawFragments.push(createRawFragment("htmlBlock", rawMarkdown, { start, end }));
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    // 5. 已注册的 MDX Callout 组件
    if (isRegisteredCalloutStart(line)) {
      const end = findMdxComponentBlockEnd(lines, index, "Callout");
      rawFragments.push(createRawFragment("registeredMdxComponent", rawMarkdown, { start, end }));
      index = findLineIndexAtOffset(lines, end);
      continue;
    }

    // 6. 其他未知的大写 MDX 块级组件
    if (isUnknownMdxFlowStart(line)) {
      rawFragments.push(
        createRawFragment("unknownMdxFlow", rawMarkdown, { start, end: start + line.length }),
      );
    }
  }
}

/**
 * 收集行内出现的未注册大写 MDX 组件标签（如 <Badge text="新" />）
 */
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

/**
 * 收集行内 MDX 表达式（如 {title} 或 {new Date().getFullYear()}）
 */
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

/**
 * 构造 RawFragment 实例
 */
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

/**
 * 按源范围起始下标升序排序切片
 */
function sortFragments(rawFragments: readonly RawFragment[]): RawFragment[] {
  return sortCopy(
    rawFragments,
    (left, right) => (left.sourceRange?.start ?? 0) - (right.sourceRange?.start ?? 0),
  );
}

function sortCopy<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  return Array.prototype.sort.call([...values], compare) as T[];
}

/**
 * 替换字符串指定区间内容
 */
function replaceRange(markdown: string, range: SourceRange, replacement: string): string {
  return `${markdown.slice(0, range.start)}${replacement}${markdown.slice(range.end)}`;
}

/**
 * 保持切片原有的换行符边界，防止换行符丢失导致相邻语法块粘连
 */
function preserveRawFragmentLineBoundary(rawSource: string, replacement: string): string {
  if (rawSource.endsWith("\n") && !replacement.endsWith("\n")) {
    return `${replacement}\n`;
  }

  return replacement;
}

/**
 * 判定给定偏移量是否已经处于已捕获的切片内
 */
function isInsideExistingFragment(offset: number, rawFragments: readonly RawFragment[]): boolean {
  return rawFragments.some((fragment) => {
    const range = fragment.sourceRange;

    return range !== undefined && offset >= range.start && offset < range.end;
  });
}

/**
 * 判定行是否以 CommonMark 规范的代码块围栏开头
 */
function isCodeFenceStart(line: string): boolean {
  return /^ {0,3}(```|~~~)/.test(line);
}

/**
 * 判定行是否为 MDX import 或 export 语句
 */
function isMdxEsmLine(line: string): boolean {
  return /^\s*(?:import|export)\s+/.test(line);
}

/**
 * 判定行是否为独立行的 MDX 表达式
 */
function isFlowMdxExpression(line: string): boolean {
  return /^\s*\{.*}\s*$/.test(line);
}

/**
 * 判定行是否为 HTML 块起始标签或 HTML 注释
 */
function isHtmlBlockStart(line: string): boolean {
  return /^\s*<\/?[a-z][A-Za-z0-9-]*(?:\s|>|\/>)/.test(line) || /^\s*<!--/.test(line);
}

/**
 * 判定行是否为已注册的 Callout 组件起始
 */
function isRegisteredCalloutStart(line: string): boolean {
  return /^\s*<Callout(?:\s|>|\/>)/.test(line);
}

/**
 * 判定行是否为未知大写 MDX 组件流起始
 */
function isUnknownMdxFlowStart(line: string): boolean {
  return /^\s*<\/?[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/.test(line);
}

/**
 * 寻找块级语法的闭合行偏移量
 */
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

/**
 * 寻找 HTML 块级标签的闭合偏移量
 */
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

/**
 * 寻找 MDX 组件的闭合标签偏移量
 */
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

/**
 * 根据字符绝对偏移量计算其所在行的下标
 */
function findLineIndexAtOffset(lines: readonly RegExpMatchArray[], offset: number): number {
  const index = lines.findIndex((line) => (line.index ?? 0) >= offset);

  return index === -1 ? lines.length - 1 : Math.max(0, index - 1);
}
