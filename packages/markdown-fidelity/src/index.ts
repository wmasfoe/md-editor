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
