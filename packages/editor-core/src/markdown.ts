/**
 * @fileoverview Markdown 块级结构解析与往返保真比对工具 (Markdown Fixtures)
 *
 * 本模块提供基础的 Markdown 块切分能力与标准化空白格式化比对方法，
 * 常用于单元测试断言、夹具数据解析以及文档纯净度校验。
 */

/**
 * 块级节点类型枚举
 */
export type MarkdownBlockType =
  "heading" | "paragraph" | "list" | "blockquote" | "image" | "codeFence" | "thematicBreak";

/**
 * 单个 Markdown 块级元素
 */
export interface MarkdownBlock {
  readonly type: MarkdownBlockType;
  readonly markdown: string;
}

/**
 * 解析后的结构化 Markdown 文档
 */
export interface MarkdownDocument {
  readonly rawMarkdown: string;
  readonly blocks: readonly MarkdownBlock[];
}

/**
 * Markdown 往返序列化比对结果
 */
export interface MarkdownRoundTripResult {
  readonly document: MarkdownDocument;
  readonly serializedMarkdown: string;
  readonly normalizedEqual: boolean;
}

/**
 * 规范化 Markdown 文本以便于断言比对
 * - 统一换行符为 \n
 * - 去除行尾多余的空格与制表符
 * - 将连续三个以上的空行折叠为两个空行
 * - 去除首尾空白并确保以单个换行符结尾
 */
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

/**
 * 解析 Markdown 文本为块级列表
 */
export function parseMarkdownFixture(rawMarkdown: string): MarkdownDocument {
  const normalizedRaw = rawMarkdown.replace(/\r\n?/g, "\n");
  const lines = normalizedRaw.split("\n");
  const blocks: MarkdownBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined || line.trim().length === 0) {
      continue;
    }

    // 1. 代码块围栏
    if (isCodeFenceStart(line)) {
      const endIndex = findCodeFenceEnd(lines, index);
      blocks.push({
        type: "codeFence",
        markdown: lines.slice(index, endIndex + 1).join("\n"),
      });
      index = endIndex;
      continue;
    }

    // 2. ATX 标题 (# 标题)
    if (/^#{1,6}\s+\S/.test(line)) {
      blocks.push({ type: "heading", markdown: line });
      continue;
    }

    // 3. 分割线 (---, ***, ___)
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "thematicBreak", markdown: line });
      continue;
    }

    // 4. 引用块 (> 引用)
    if (/^>\s?/.test(line)) {
      const endIndex = consumeWhile(lines, index, (candidate) => /^>\s?/.test(candidate));
      blocks.push({ type: "blockquote", markdown: lines.slice(index, endIndex + 1).join("\n") });
      index = endIndex;
      continue;
    }

    // 5. 列表项 (- 列表 或 1. 列表)
    if (/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) {
      const endIndex = consumeWhile(lines, index, (candidate) =>
        /^\s*(?:[-*+]|\d+\.)\s+\S/.test(candidate),
      );
      blocks.push({ type: "list", markdown: lines.slice(index, endIndex + 1).join("\n") });
      index = endIndex;
      continue;
    }

    // 6. 独占一行的图片
    if (/^!\[[^\]]*]\([^)]+\)/.test(line)) {
      blocks.push({ type: "image", markdown: line });
      continue;
    }

    // 7. 普通段落
    const endIndex = consumeParagraph(lines, index);
    blocks.push({ type: "paragraph", markdown: lines.slice(index, endIndex + 1).join("\n") });
    index = endIndex;
  }

  return { rawMarkdown, blocks };
}

/**
 * 序列化文档对象为纯文本
 */
export function serializeMarkdownDocument(document: MarkdownDocument): string {
  return document.rawMarkdown;
}

/**
 * 执行 Markdown 往返测试比对
 */
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
  const startLine = lines[startIndex] ?? "";
  const fenceChar = startLine.trimStart().startsWith("~~~") ? "~" : "`";
  const fencePattern = new RegExp(`^ {0,3}${fenceChar}{3,}`);

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (fencePattern.test(lines[index] ?? "")) {
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
  let lastMatchingIndex = startIndex;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !predicate(line)) {
      break;
    }
    lastMatchingIndex = index;
  }

  return lastMatchingIndex;
}

function consumeParagraph(lines: readonly string[], startIndex: number): number {
  let lastIndex = startIndex;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0 || isBlockStart(line)) {
      break;
    }
    lastIndex = index;
  }

  return lastIndex;
}

function isBlockStart(line: string): boolean {
  return (
    isCodeFenceStart(line) ||
    /^#{1,6}\s+\S/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*(?:[-*+]|\d+\.)\s+\S/.test(line) ||
    /^!\[[^\]]*]\([^)]+\)/.test(line)
  );
}
