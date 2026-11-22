import {
  createHeadingSlugAllocator,
  normalizeLineEndings,
  slugifyHeading,
} from "@md-editor/shared";

export interface FrontmatterBlock {
  readonly raw: string;
  readonly body: string;
}

export interface MarkdownSourceRange {
  readonly from: number;
  readonly to: number;
}

export interface FrontmatterSourceRange {
  readonly status: "closed" | "unterminated";
  readonly precedence: "frontmatter";
  readonly fullRange: MarkdownSourceRange;
  readonly openingFenceRange: MarkdownSourceRange;
  readonly contentRange: MarkdownSourceRange;
  readonly closingFenceRange: MarkdownSourceRange | null;
  readonly raw: string;
  readonly content: string;
}

export interface HeadingOutlineItem {
  readonly id: string;
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface RoundTripResult {
  readonly markdown: string;
  readonly changed: boolean;
}

export interface MarkdownImagePreviewInput {
  readonly markdown: string;
  readonly sourceMap: readonly [previewSrc: string, markdownSrc: string][];
}

export interface MarkdownRawBlockPreviewInput {
  readonly markdown: string;
  readonly sourceMap: readonly [previewBlock: string, markdownBlock: string][];
}

export interface MarkdownImageSrcResolverOptions {
  readonly convertFileSrc?: (path: string) => string;
  readonly hasTauriRuntime?: boolean;
}

export function findFrontmatterSourceRange(markdown: string): FrontmatterSourceRange | null {
  const normalized = normalizeLineEndings(markdown);
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  let lineStart = 4;
  while (lineStart <= normalized.length) {
    const newlineIndex = normalized.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? normalized.length : newlineIndex;
    if (normalized.slice(lineStart, lineEnd) === "---") {
      const fullRange = Object.freeze({ from: 0, to: lineEnd });
      const contentRange = Object.freeze({ from: 4, to: lineStart });
      return Object.freeze({
        status: "closed",
        precedence: "frontmatter",
        fullRange,
        openingFenceRange: Object.freeze({ from: 0, to: 3 }),
        contentRange,
        closingFenceRange: Object.freeze({ from: lineStart, to: lineEnd }),
        raw: normalized.slice(fullRange.from, fullRange.to),
        content: normalized.slice(contentRange.from, contentRange.to),
      });
    }

    if (newlineIndex === -1) {
      break;
    }
    lineStart = newlineIndex + 1;
  }

  const fullRange = Object.freeze({ from: 0, to: normalized.length });
  const contentRange = Object.freeze({ from: 4, to: normalized.length });
  return Object.freeze({
    status: "unterminated",
    precedence: "frontmatter",
    fullRange,
    openingFenceRange: Object.freeze({ from: 0, to: 3 }),
    contentRange,
    closingFenceRange: null,
    raw: normalized,
    content: normalized.slice(contentRange.from),
  });
}

export function splitFrontmatter(markdown: string): FrontmatterBlock | null {
  const normalized = normalizeLineEndings(markdown);
  const range = findFrontmatterSourceRange(normalized);
  if (!range || range.status !== "closed") {
    return null;
  }

  // Preserve Frontmatter as raw source; this layer never parses or reorders YAML.
  const bodyStart =
    normalized[range.fullRange.to] === "\n" ? range.fullRange.to + 1 : range.fullRange.to;
  return {
    raw: range.raw,
    body: normalized.slice(bodyStart),
  };
}

export function serializeRoundTrip(markdown: string): RoundTripResult {
  const normalized = normalizeLineEndings(markdown);
  // 这个占位 serializer 明确当前规范化边界：
  // 只允许行尾和最终换行发生变化。
  const withTrailingNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`;

  return {
    markdown: withTrailingNewline,
    changed: withTrailingNewline !== markdown,
  };
}

export function createMarkdownImageSrcResolver(
  documentPath: string | null | undefined,
  options: MarkdownImageSrcResolverOptions = {},
) {
  return (src: string): string => {
    if (isRemoteOrEmbeddedImageSrc(src) || src.startsWith("#")) {
      return src;
    }

    if (!options.convertFileSrc || options.hasTauriRuntime === false) {
      return src;
    }

    const decodedSrc = decodeMarkdownImagePath(src);
    const isAbsolute = decodedSrc.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(decodedSrc);
    if (!isAbsolute && !documentPath) {
      return src;
    }

    const targetPath = isAbsolute ? decodedSrc : resolveLocalImagePath(src, documentPath!);
    return options.convertFileSrc(targetPath);
  };
}

export function rewriteMarkdownImageSourcesForPreview(
  markdown: string,
  resolveImageSrc: (src: string) => string,
): MarkdownImagePreviewInput {
  const sourceMap: [string, string][] = [];
  const previewMarkdown = markdown.replace(
    /(!\[[^\]]*\]\()((?:<[^>\n]+>)|(?:[^)\s\n]+))(?:\s+"[^"\n]*")?(\))/g,
    (source) => {
      const image = parseImageMarkdown(source);
      if (!image) {
        return source;
      }

      const previewSrc = resolveImageSrc(image.src);
      if (previewSrc === image.src) {
        return source;
      }

      sourceMap.push([previewSrc, image.src]);
      return source.replace(image.src, previewSrc);
    },
  );

  return { markdown: previewMarkdown, sourceMap };
}

export function restoreMarkdownImageSources(
  markdown: string,
  sourceMap: readonly [previewSrc: string, markdownSrc: string][],
): string {
  return sourceMap.reduce((nextMarkdown, [previewSrc, markdownSrc]) => {
    return nextMarkdown.split(previewSrc).join(markdownSrc);
  }, markdown);
}

export function rewriteRawBlocksForPreview(markdown: string): MarkdownRawBlockPreviewInput {
  const sourceMap: [string, string][] = [];
  const frontmatter = matchFrontmatterSource(markdown);
  let previewMarkdown = markdown;

  if (frontmatter) {
    const previewBlock = createManagedRawFence("frontmatter", stripFrontmatterFence(frontmatter));
    previewMarkdown = previewBlock + previewMarkdown.slice(frontmatter.length);
    sourceMap.push([previewBlock, frontmatter]);
  }

  // MDX raw-block 托管只能作用在正文段落；代码围栏里的 Vue/TSX 示例必须原样保留。
  previewMarkdown = replaceOutsideMarkdownCodeFences(previewMarkdown, (markdownSegment) =>
    markdownSegment.replace(
      /^ {0,3}<([A-Z][A-Za-z0-9.:-]*)(?:\s[^>\n]*)?(?:\/>|>[\s\S]*?<\/\1>)(?:\r?\n|$)/gm,
      (source) => {
        const kind = /^\s*<Callout(?:\s|>|\/>)/u.test(source) ? "callout" : "mdx";
        const previewBlock = createManagedRawFence(kind, source.replace(/\r?\n$/u, ""));
        sourceMap.push([previewBlock, source]);
        return previewBlock;
      },
    ),
  );

  return { markdown: previewMarkdown, sourceMap };
}

export function restoreRawBlocksFromPreview(
  markdown: string,
  sourceMap: readonly [previewBlock: string, markdownBlock: string][],
): string {
  return sourceMap.reduce((nextMarkdown, [previewBlock, markdownBlock]) => {
    const edited = extractManagedRawFenceContent(previewBlock, nextMarkdown);
    if (edited === null) {
      return nextMarkdown.split(previewBlock).join(markdownBlock);
    }

    const restored = restoreManagedRawBlock(markdownBlock, edited);
    return nextMarkdown.replace(edited.fence, restored);
  }, markdown);
}

export function extractHeadingOutline(markdown: string): readonly HeadingOutlineItem[] {
  // 去重是文档级属性，用 shared 的分配器（与 HTML 导出共用同一语义）。
  const allocate = createHeadingSlugAllocator();
  const outline: HeadingOutlineItem[] = [];
  const lines = normalizeLineEndings(markdown).split("\n");

  /**
   * 代码围栏状态：**必须跳过围栏内的行**。
   *
   * 导出走 Markdown token，围栏里的 `# xxx` 从来不是标题；大纲若用裸正则逐行扫，
   * 围栏内的假标题会先占掉 id，导致围栏外真正的同名标题被推到 `-1`，
   * 大纲里的链接于是指向导出 HTML 里不存在（或指向别处）的 id。
   *
   * 复用本文件已有的 `matchOpeningCodeFence` / `isClosingCodeFence`，
   * 与 `replaceManagedRawBlocks` 用同一套 CommonMark 围栏判定。
   */
  let openFence: {
    readonly marker: "`" | "~";
    readonly length: number;
    readonly indent: number;
  } | null = null;
  /** 当前是否处在列表项内部（缩进围栏的判定依据）。 */
  let insideListItem = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (openFence) {
      if (isClosingCodeFence(line, openFence)) {
        openFence = null;
      }
      continue;
    }

    const fence = matchOpeningCodeFence(line);
    if (fence) {
      // 缩进围栏只有在**不处于列表项**时才是真正的开启围栏。
      //
      // 列表项里的收尾围栏写作 `  ``` `（缩进 2 格），列表项标记 `- ` 本身
      // 又让它前面那行不是围栏开头。若不判断上下文，这个收尾行会被当成
      // 新的开启围栏，而它永远等不到同缩进的闭合行，于是把文档剩余部分全部
      // 吞进围栏 —— 大纲里之后的标题凭空消失（实测踩过）。
      if (fence.indent > 0 && insideListItem) {
        continue;
      }
      openFence = fence;
      continue;
    }

    // 列表项上下文：用于区分"列表项里的收尾围栏"与"真正的缩进开启围栏"。
    if (/^\s*([-*+]|\d+[.)])\s/u.test(line)) {
      insideListItem = true;
    } else if (line.trim() !== "" && !/^\s/u.test(line)) {
      insideListItem = false;
    }

    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) {
      continue;
    }

    const text = match[2].trim();
    outline.push({
      id: allocate(text),
      level: match[1].length,
      text,
      line: index + 1,
    });
  }

  return outline;
}

export function findActiveHeadingIdForLine(
  outline: readonly HeadingOutlineItem[],
  line: number,
): string | null {
  let active: HeadingOutlineItem | null = null;

  for (const item of outline) {
    if (item.line > line) {
      break;
    }

    // The visible section is the closest preceding heading. This keeps the
    // outline stable while the cursor or scroll position moves through body text.
    active = item;
  }

  return active?.id ?? null;
}

// 行内语法剥离已下沉到 `@md-editor/shared` 的 `headingSlugSource`：
// 大纲、文档内锚点解析、导出 HTML 三者共用同一实现，避免再次漂移。

export function headingAnchorSlug(source: string): string {
  // 单一实现：与大纲、HTML 导出共用 `@md-editor/shared` 的规则。
  return slugifyHeading(source);
}

/**
 * 宽松比较键：忽略标点、空白与连字符的差异。
 *
 * 手工撰写或不同 TOC 生成器的锚点对 `、：（）➔` 的处置并不一致
 * （有的转成 `-`，有的直接丢弃），因此精确匹配失败后按可见字符比对。
 */
function looseHeadingKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/** 规范化锚点片段：容忍前导 `#`、百分号编码与大小写差异。 */
function normalizeHeadingFragment(fragment: string): string {
  let value = fragment.trim();
  if (value.startsWith("#")) {
    value = value.slice(1);
  }
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // 非法的百分号序列：保留原样，按字面比较
    }
  }
  return value.trim().toLowerCase();
}

/**
 * 把文档内锚点（`#fragment`）解析为对应标题。
 *
 * 匹配顺序：
 * 1. 精确命中：大纲 id（已包含 GitHub 去重后缀 `-1`、`-2`）；
 * 2. 全文档无精确命中时，取第一个宽松匹配（忽略标点/空白/连字符差异）。
 *
 * 只做确定性比对，不做相似度猜测：找不到返回 `null`，由调用方提示失败。
 * 不再兼容旧的 `-2` 起编号：大纲与导出 HTML 现在共用同一套 GitHub 语义。
 */
export function resolveHeadingAnchor(
  markdown: string,
  fragment: string,
): HeadingOutlineItem | null {
  const wanted = normalizeHeadingFragment(fragment);
  if (wanted.length === 0) {
    return null;
  }

  const outline = extractHeadingOutline(markdown);
  const wantedLoose = looseHeadingKey(wanted);
  // 宽松匹配只做兜底：先记下第一个候选，等整份文档都没有精确命中再返回。
  let looseMatch: HeadingOutlineItem | null = null;

  for (const item of outline) {
    if (item.id === wanted) {
      return item;
    }
    if (looseMatch === null && wantedLoose.length > 0 && looseHeadingKey(item.id) === wantedLoose) {
      looseMatch = item;
    }
  }

  return looseMatch;
}

export function isLikelyMdxBlock(markdown: string): boolean {
  // 大写 JSX 标签暂时只识别为需要保留的 MDX 组件源码，
  // 不渲染，也不执行。
  return /^\s*<[A-Z][\w.:-]*(\s|>|\/>)/m.test(markdown);
}

function isRemoteOrEmbeddedImageSrc(src: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(src) && !/^[a-zA-Z]:[\\/]/u.test(src);
}

function matchFrontmatterSource(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
  return match?.[0] ?? null;
}

function stripFrontmatterFence(frontmatter: string): string {
  return frontmatter.replace(/^---\r?\n/u, "").replace(/\r?\n---(?:\r?\n)?$/u, "");
}

function createManagedRawFence(kind: "frontmatter" | "callout" | "mdx", source: string): string {
  const language = kind === "frontmatter" ? "yaml" : "mdx";
  return `\`\`\`${language} md-editor-${kind}\n${source}\n\`\`\`\n`;
}

function replaceOutsideMarkdownCodeFences(
  markdown: string,
  replaceSegment: (markdownSegment: string) => string,
): string {
  let result = "";
  let plainStart = 0;
  let index = 0;

  while (index < markdown.length) {
    const lineEnd = markdown.indexOf("\n", index);
    const nextIndex = lineEnd === -1 ? markdown.length : lineEnd + 1;
    const line = markdown.slice(index, lineEnd === -1 ? markdown.length : lineEnd);
    const fence = matchOpeningCodeFence(line);

    if (!fence) {
      index = nextIndex;
      continue;
    }

    result += replaceSegment(markdown.slice(plainStart, index));
    const fenceStart = index;
    index = nextIndex;

    while (index < markdown.length) {
      const closingLineEnd = markdown.indexOf("\n", index);
      const closingNextIndex = closingLineEnd === -1 ? markdown.length : closingLineEnd + 1;
      const closingLine = markdown.slice(
        index,
        closingLineEnd === -1 ? markdown.length : closingLineEnd,
      );

      index = closingNextIndex;

      if (isClosingCodeFence(closingLine, fence)) {
        break;
      }
    }

    result += markdown.slice(fenceStart, index);
    plainStart = index;
  }

  return result + replaceSegment(markdown.slice(plainStart));
}

function matchOpeningCodeFence(
  line: string,
): { readonly marker: "`" | "~"; readonly length: number; readonly indent: number } | null {
  const match = /^( {0,3})(`{3,}|~{3,})/u.exec(line);

  if (!match) {
    return null;
  }

  const indent = match[1].length;
  const sequence = match[2];
  const marker = sequence[0] as "`" | "~";
  const infoString = line.slice(match[0].length);

  // CommonMark 不允许反引号代码围栏的 info string 再包含反引号。
  if (marker === "`" && infoString.includes("`")) {
    return null;
  }

  return { marker, length: sequence.length, indent };
}

function isClosingCodeFence(
  line: string,
  opening: { readonly marker: "`" | "~"; readonly length: number; readonly indent: number },
): boolean {
  const match = /^( {0,3})(`+|~+)\s*$/u.exec(line);

  if (!match) {
    return false;
  }
  return match[2][0] === opening.marker && match[2].length >= opening.length;
}

function extractManagedRawFenceContent(
  previewBlock: string,
  markdown: string,
): { readonly fence: string; readonly body: string } | null {
  const firstLine = previewBlock.slice(0, previewBlock.indexOf("\n"));
  const match =
    matchFenceByFirstLine(markdown, firstLine) ??
    matchManagedCalloutFallback(markdown, previewBlock);

  if (!match || match[1] === undefined) {
    return null;
  }

  return { fence: match[0], body: match[1] };
}

function matchFenceByFirstLine(markdown: string, firstLine: string): RegExpMatchArray | null {
  const escapedFirstLine = escapeRegExp(firstLine);
  const pattern = new RegExp(
    `${escapedFirstLine}\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`(?:\\r?\\n|$)`,
    "u",
  );
  return markdown.match(pattern);
}

function matchManagedCalloutFallback(
  markdown: string,
  previewBlock: string,
): RegExpMatchArray | null {
  if (!previewBlock.startsWith("```mdx md-editor-callout\n")) {
    return null;
  }

  const pattern =
    /```mdx\r?\n(\s*<Callout(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/Callout>)\s*)\r?\n```(?:\r?\n|$)/u;
  return markdown.match(pattern);
}

function restoreManagedRawBlock(originalBlock: string, edited: { readonly body: string }): string {
  if (originalBlock.startsWith("---")) {
    return `---\n${edited.body}\n---\n`;
  }

  return `${edited.body}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseImageMarkdown(source: string): { readonly src: string } | null {
  const match = /^!\[[^\]]*\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+"[^"\n]*")?\)$/u.exec(
    source.trim(),
  );

  return match ? { src: match[1] ?? match[2] ?? "" } : null;
}

function resolveLocalImagePath(src: string, documentPath: string): string {
  const decodedSrc = decodeMarkdownImagePath(src);
  const separator = documentPath.includes("\\") && !documentPath.includes("/") ? "\\" : "/";

  if (decodedSrc.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(decodedSrc)) {
    return decodedSrc;
  }

  const parts = [...documentDirectory(documentPath).split(/[\\/]/u), ...decodedSrc.split(/[\\/]/u)];
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  return documentPath.startsWith("/")
    ? `/${resolvedParts.join("/")}`
    : resolvedParts.join(separator);
}

function documentDirectory(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

  return slash < 0 ? "" : path.slice(0, slash);
}

function decodeMarkdownImagePath(src: string): string {
  try {
    return decodeURI(src.split(/[?#]/u)[0] ?? src);
  } catch {
    return src;
  }
}
