import { normalizeLineEndings } from "@md-editor/shared";

export interface FrontmatterBlock {
  readonly raw: string;
  readonly body: string;
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

export function splitFrontmatter(markdown: string): FrontmatterBlock | null {
  const normalized = normalizeLineEndings(markdown);
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  // Frontmatter 作为原始元数据块保存；v0.1 只展示和移动它，
  // 不解析重排注释、引号或 key 顺序。
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }

  return {
    raw: normalized.slice(0, closingIndex + "\n---".length),
    body: normalized.slice(closingIndex + "\n---\n".length),
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
    if (!documentPath || isRemoteOrEmbeddedImageSrc(src) || src.startsWith("#")) {
      return src;
    }

    if (!options.convertFileSrc || options.hasTauriRuntime === false) {
      return src;
    }

    return options.convertFileSrc(resolveLocalImagePath(src, documentPath));
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

export function findMarkdownImageAuthorSource(
  sourceMap: readonly [previewSrc: string, markdownSrc: string][],
  previewSrc: string,
): string {
  return sourceMap.find(([mappedPreviewSrc]) => mappedPreviewSrc === previewSrc)?.[1] ?? previewSrc;
}

export function upsertMarkdownImageSourceMapping(
  sourceMap: readonly [previewSrc: string, markdownSrc: string][],
  previewSrc: string,
  markdownSrc: string,
): [previewSrc: string, markdownSrc: string][] {
  if (previewSrc === markdownSrc) {
    return [...sourceMap];
  }

  return [
    ...sourceMap.filter(
      ([mappedPreviewSrc, mappedMarkdownSrc]) =>
        mappedPreviewSrc !== previewSrc && mappedMarkdownSrc !== markdownSrc,
    ),
    [previewSrc, markdownSrc],
  ];
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
  const seen = new Map<string, number>();
  const outline: HeadingOutlineItem[] = [];
  const lines = normalizeLineEndings(markdown).split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const text = match[2].trim();
    const slug = slugify(text);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    outline.push({
      id: count === 0 ? slug : `${slug}-${count + 1}`,
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

export function isLikelyMdxBlock(markdown: string): boolean {
  // 大写 JSX 标签暂时只识别为需要保留的 MDX 组件源码，
  // 不渲染，也不执行。
  return /^\s*<[A-Z][\w.:-]*(\s|>|\/>)/m.test(markdown);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "");
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
): { readonly marker: "`" | "~"; readonly length: number } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/u.exec(line);

  if (!match) {
    return null;
  }

  const sequence = match[1];
  const marker = sequence[0] as "`" | "~";
  const infoString = line.slice(match[0].length);

  // CommonMark 不允许反引号代码围栏的 info string 再包含反引号。
  if (marker === "`" && infoString.includes("`")) {
    return null;
  }

  return { marker, length: sequence.length };
}

function isClosingCodeFence(
  line: string,
  opening: { readonly marker: "`" | "~"; readonly length: number },
): boolean {
  const match = /^(?: {0,3})(`+|~+)\s*$/u.exec(line);

  return Boolean(match && match[1][0] === opening.marker && match[1].length >= opening.length);
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
