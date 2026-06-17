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
    body: normalized.slice(closingIndex + "\n---\n".length)
  };
}

export function serializeRoundTrip(markdown: string): RoundTripResult {
  const normalized = normalizeLineEndings(markdown);
  // 这个占位 serializer 明确当前规范化边界：
  // 只允许行尾和最终换行发生变化。
  const withTrailingNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`;

  return {
    markdown: withTrailingNewline,
    changed: withTrailingNewline !== markdown
  };
}

export function createMarkdownImageSrcResolver(
  documentPath: string | null | undefined,
  options: MarkdownImageSrcResolverOptions = {}
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
  resolveImageSrc: (src: string) => string
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
    }
  );

  return { markdown: previewMarkdown, sourceMap };
}

export function restoreMarkdownImageSources(
  markdown: string,
  sourceMap: readonly [previewSrc: string, markdownSrc: string][]
): string {
  return sourceMap.reduce((nextMarkdown, [previewSrc, markdownSrc]) => {
    return nextMarkdown.split(previewSrc).join(markdownSrc);
  }, markdown);
}

export function extractHeadingOutline(markdown: string): readonly HeadingOutlineItem[] {
  const seen = new Map<string, number>();

  return normalizeLineEndings(markdown)
    .split("\n")
    .flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (!match) {
        return [];
      }

      const text = match[2].trim();
      const slug = slugify(text);
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);

      return [
        {
          id: count === 0 ? slug : `${slug}-${count + 1}`,
          level: match[1].length,
          text,
          line: index + 1
        }
      ];
    });
}

export function findActiveHeadingIdForLine(
  outline: readonly HeadingOutlineItem[],
  line: number
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

function parseImageMarkdown(source: string): { readonly src: string } | null {
  const match = /^!\[[^\]]*\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+"[^"\n]*")?\)$/u.exec(
    source.trim()
  );

  return match ? { src: match[1] ?? match[2] ?? "" } : null;
}

function resolveLocalImagePath(src: string, documentPath: string): string {
  const decodedSrc = decodeMarkdownImagePath(src);
  const separator = documentPath.includes("\\") && !documentPath.includes("/") ? "\\" : "/";

  if (decodedSrc.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(decodedSrc)) {
    return decodedSrc;
  }

  const parts = [
    ...documentDirectory(documentPath).split(/[\\/]/u),
    ...decodedSrc.split(/[\\/]/u)
  ];
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

  return documentPath.startsWith("/") ? `/${resolvedParts.join("/")}` : resolvedParts.join(separator);
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
