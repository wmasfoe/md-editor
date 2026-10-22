import { describe, expect, it } from "vitest";
import {
  createMarkdownImageSrcResolver,
  extractHeadingOutline,
  findFrontmatterSourceRange,
  findActiveHeadingIdForLine,
  headingAnchorSlug,
  isLikelyMdxBlock,
  resolveHeadingAnchor,
  restoreMarkdownImageSources,
  restoreRawBlocksFromPreview,
  rewriteMarkdownImageSourcesForPreview,
  rewriteRawBlocksForPreview,
  serializeRoundTrip,
  splitFrontmatter,
} from "../src";

describe("frontmatter preservation", () => {
  it("keeps raw frontmatter text separate from body", () => {
    const markdown = '---\n# comment\ntitle: "Post"\ndate: 2026-06-12\n---\n# Body\n';

    expect(splitFrontmatter(markdown)).toEqual({
      raw: '---\n# comment\ntitle: "Post"\ndate: 2026-06-12\n---',
      body: "# Body\n",
    });
  });

  it("does not treat invalid top matter as frontmatter", () => {
    expect(splitFrontmatter("---\ntitle: Post\n# Missing close")).toBeNull();
  });

  it("returns exact normalized ranges without parsing YAML", () => {
    const markdown = '---\r\n# comment\r\ntitle: "Post"\r\n---\r\n# Body\r\n';
    expect(findFrontmatterSourceRange(markdown)).toEqual({
      status: "closed",
      precedence: "frontmatter",
      fullRange: { from: 0, to: 31 },
      openingFenceRange: { from: 0, to: 3 },
      contentRange: { from: 4, to: 28 },
      closingFenceRange: { from: 28, to: 31 },
      raw: '---\n# comment\ntitle: "Post"\n---',
      content: '# comment\ntitle: "Post"\n',
    });
  });

  it("reports an unterminated document-start range for safe renderer fallback", () => {
    expect(findFrontmatterSourceRange("---\ntitle: [unterminated\n")).toEqual({
      status: "unterminated",
      precedence: "frontmatter",
      fullRange: { from: 0, to: 25 },
      openingFenceRange: { from: 0, to: 3 },
      contentRange: { from: 4, to: 25 },
      closingFenceRange: null,
      raw: "---\ntitle: [unterminated\n",
      content: "title: [unterminated\n",
    });
  });

  it("accepts a closing fence at end of file and rejects later delimiters", () => {
    expect(findFrontmatterSourceRange("---\ntitle: End\n---")?.status).toBe("closed");
    expect(findFrontmatterSourceRange("body\n\n---\ntitle: Later\n---")).toBeNull();
  });
});

describe("round-trip normalization", () => {
  it("only adds a final trailing newline in the placeholder serializer", () => {
    expect(serializeRoundTrip('<Callout type="info" />')).toEqual({
      markdown: '<Callout type="info" />\n',
      changed: true,
    });
  });

  it("preserves raw blocks that already include a final newline", () => {
    const markdown = "```ts meta\nconst value = 1;\n```\n";

    expect(serializeRoundTrip(markdown)).toEqual({
      markdown,
      changed: false,
    });
  });
});

describe("outline extraction", () => {
  it("extracts h1-h6 headings with stable duplicate ids", () => {
    expect(extractHeadingOutline("# A\n## B\n### B\n")).toEqual([
      { id: "a", level: 1, text: "A", line: 1 },
      { id: "b", level: 2, text: "B", line: 2 },
      { id: "b-2", level: 3, text: "B", line: 3 },
    ]);
  });

  it("finds the active heading for a visible line", () => {
    const outline = extractHeadingOutline("# A\nbody\n## B\nmore\n### C\n");

    expect(findActiveHeadingIdForLine(outline, 1)).toBe("a");
    expect(findActiveHeadingIdForLine(outline, 4)).toBe("b");
    expect(findActiveHeadingIdForLine(outline, 99)).toBe("c");
    expect(findActiveHeadingIdForLine(outline, 0)).toBeNull();
  });

  it("keeps heading positions stable in a large document", () => {
    const markdown = Array.from({ length: 10_000 }, (_, index) =>
      index % 1_000 === 0 ? `## Section ${index}` : `paragraph ${index}`,
    ).join("\n");

    const outline = extractHeadingOutline(markdown);
    expect(outline).toHaveLength(10);
    expect(outline.at(-1)).toMatchObject({ text: "Section 9000", line: 9001 });
  });
});

describe("heading anchor resolution", () => {
  /**
   * 属主报告：手动输入目录（锚点链接）后 Cmd/Ctrl+左击无法跳转。
   * 这些锚点来自 TOC 生成器/手工撰写，标点处理与本仓库 slugify 不一致
   * （`、`→`-`、`：`/`？`/`（）`/`➔` 直接丢弃），因此解析必须容忍差异。
   */
  const DOCUMENT = [
    "1. [全景搭配图](#一-全景搭配图这些-skills-怎么组合最爽)",
    "2. [短剧全流程](#二-第一类短剧全流程导演与制片-skills剧本--分镜--视频--成片)",
    "",
    "## 一、全景搭配图：这些 Skills 怎么组合最爽？",
    "",
    "正文",
    "",
    "## 二、第一类：短剧全流程导演与制片 Skills（剧本 ➔ 分镜 ➔ 视频 ➔ 成片）",
    "",
  ].join("\n");

  it("matches GitHub 风格锚点（标点直接丢弃）", () => {
    expect(headingAnchorSlug("一、全景搭配图：这些 Skills 怎么组合最爽？")).toBe(
      "一全景搭配图这些-skills-怎么组合最爽",
    );
    expect(resolveHeadingAnchor(DOCUMENT, "一全景搭配图这些-skills-怎么组合最爽")).toMatchObject({
      line: 4,
      level: 2,
    });
  });

  it("容忍 TOC 生成器之间不一致的标点→连字符策略", () => {
    expect(resolveHeadingAnchor(DOCUMENT, "一-全景搭配图这些-skills-怎么组合最爽")).toMatchObject({
      line: 4,
    });
    expect(
      resolveHeadingAnchor(DOCUMENT, "二-第一类短剧全流程导演与制片-skills剧本--分镜--视频--成片"),
    ).toMatchObject({ line: 8 });
  });

  it("接受百分号编码、`#` 前缀与大小写差异", () => {
    expect(
      resolveHeadingAnchor(
        DOCUMENT,
        `#${encodeURIComponent("一-全景搭配图这些-skills-怎么组合最爽")}`,
      ),
    ).toMatchObject({ line: 4 });
    expect(resolveHeadingAnchor("# Hello World\n", "HELLO-WORLD")).toMatchObject({ line: 1 });
  });

  it("按渲染文本生成锚点（剔除行内标记与链接目标）", () => {
    const markdown = "## 使用 `npm run dev` 启动 [开发服务器](https://example.com)\n";
    expect(headingAnchorSlug("使用 `npm run dev` 启动 [开发服务器](https://example.com)")).toBe(
      "使用-npm-run-dev-启动-开发服务器",
    );
    expect(resolveHeadingAnchor(markdown, "使用-npm-run-dev-启动-开发服务器")).toMatchObject({
      line: 1,
    });
  });

  it("支持重复标题的 GitHub 后缀与既有大纲 id 后缀", () => {
    const markdown = "# A\n\ntext\n\n## A\n";

    expect(resolveHeadingAnchor(markdown, "a")).toMatchObject({ line: 1 });
    expect(resolveHeadingAnchor(markdown, "a-1")).toMatchObject({ line: 5 });
    expect(resolveHeadingAnchor(markdown, "a-2")).toMatchObject({ line: 5 });
  });

  it("找不到锚点时返回 null（不猜相似标题）", () => {
    expect(resolveHeadingAnchor(DOCUMENT, "不存在的锚点")).toBeNull();
    expect(resolveHeadingAnchor(DOCUMENT, "")).toBeNull();
    expect(resolveHeadingAnchor("没有标题\n", "anything")).toBeNull();
  });
});

describe("MDX raw block detection", () => {
  it("detects unknown MDX component blocks without executing them", () => {
    expect(isLikelyMdxBlock('<CustomThing foo="bar" />')).toBe(true);
    expect(isLikelyMdxBlock("<div>html</div>")).toBe(false);
  });

  it("rewrites frontmatter and MDX blocks into managed preview fences", () => {
    const input = [
      "---",
      "title: Draft",
      "---",
      "",
      '<Callout type="info">Read this.</Callout>',
      "",
      '<CustomThing value="x" />',
      "",
    ].join("\n");
    const preview = rewriteRawBlocksForPreview(input);

    expect(preview.markdown).toContain("```yaml md-editor-frontmatter\ntitle: Draft\n```");
    expect(preview.markdown).toContain(
      '```mdx md-editor-callout\n<Callout type="info">Read this.</Callout>\n```',
    );
    expect(preview.markdown).toContain('```mdx md-editor-mdx\n<CustomThing value="x" />\n```');
    expect(restoreRawBlocksFromPreview(preview.markdown, preview.sourceMap)).toBe(input);
  });

  it("does not rewrite Vue components inside fenced code blocks as MDX raw blocks", () => {
    const input = [
      "**v-model 绑定**:",
      "",
      "```vue",
      '<AdvCheckboxSelector v-model="formData.advIds" :bc-id="currentBcId" />',
      "```",
      "",
      "**样式参考**: 复用 `AuthDialog.vue` 的 `.auth-all-list` 样式类",
      "",
      "```typescript",
      "export function useUserManagement() {",
      "  return {}",
      "}",
      "```",
      "",
      '<CustomThing value="x" />',
      "",
    ].join("\n");
    const preview = rewriteRawBlocksForPreview(input);

    expect(preview.markdown).toContain(
      [
        "```vue",
        '<AdvCheckboxSelector v-model="formData.advIds" :bc-id="currentBcId" />',
        "```",
      ].join("\n"),
    );
    expect(preview.markdown).toContain("```typescript\nexport function useUserManagement()");
    expect(preview.markdown).not.toContain("```mdx md-editor-mdx\n<AdvCheckboxSelector");
    expect(preview.markdown).toContain('```mdx md-editor-mdx\n<CustomThing value="x" />\n```');
    expect(restoreRawBlocksFromPreview(preview.markdown, preview.sourceMap)).toBe(input);
  });

  it("restores edited managed raw blocks to author-facing Markdown", () => {
    const input = '---\ntitle: Draft\n---\n\n<Callout type="info">Read this.</Callout>\n';
    const preview = rewriteRawBlocksForPreview(input);
    const editedPreview = preview.markdown
      .replace("title: Draft", "title: Final")
      .replace("Read this.", "Updated.");

    expect(restoreRawBlocksFromPreview(editedPreview, preview.sourceMap)).toBe(
      '---\ntitle: Final\n---\n\n<Callout type="info">Updated.</Callout>\n',
    );
  });

  it("restores Callout when the editor normalizes the managed fence language metadata", () => {
    const input = '<Callout type="info" title="提示">\n  内容\n</Callout>\n';
    const preview = rewriteRawBlocksForPreview(input);
    const normalizedPreview = preview.markdown.replace("```mdx md-editor-callout", "```mdx");

    expect(restoreRawBlocksFromPreview(normalizedPreview, preview.sourceMap)).toBe(input);
  });
});

describe("local Markdown image preview sources", () => {
  it("resolves relative image paths through the desktop asset protocol", () => {
    const resolveImageSrc = createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
      hasTauriRuntime: true,
      convertFileSrc: (path) => `asset://${path}`,
    });

    expect(resolveImageSrc("assets/pasted%20image.png")).toBe(
      "asset:///Users/me/docs/assets/pasted image.png",
    );
  });

  it("resolves absolute image paths even without an active document", () => {
    const resolveImageSrc = createMarkdownImageSrcResolver(null, {
      hasTauriRuntime: true,
      convertFileSrc: (path) => `asset://${path}`,
    });

    expect(resolveImageSrc("/Users/me/pictures/banner.png")).toBe(
      "asset:///Users/me/pictures/banner.png",
    );
    expect(resolveImageSrc("C:\\Users\\me\\pictures\\banner.png")).toBe(
      "asset://C:\\Users\\me\\pictures\\banner.png",
    );
  });

  it("leaves remote, embedded, and non-desktop image sources unchanged", () => {
    const resolveImageSrc = createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
      hasTauriRuntime: true,
      convertFileSrc: (path) => `asset://${path}`,
    });

    expect(resolveImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(resolveImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(
      createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
        hasTauriRuntime: false,
        convertFileSrc: (path) => `asset://${path}`,
      })("assets/a.png"),
    ).toBe("assets/a.png");
  });

  it("rewrites preview Markdown and restores original persisted sources", () => {
    const input = "before\n\n![shot](assets/a.png)\n\n![remote](https://example.com/a.png)\n";
    const preview = rewriteMarkdownImageSourcesForPreview(
      input,
      createMarkdownImageSrcResolver("/Users/me/docs/today.md", {
        hasTauriRuntime: true,
        convertFileSrc: (path) => `asset://${path}`,
      }),
    );

    expect(preview.markdown).toContain("![shot](asset:///Users/me/docs/assets/a.png)");
    expect(preview.markdown).toContain("![remote](https://example.com/a.png)");
    expect(restoreMarkdownImageSources(preview.markdown, preview.sourceMap)).toBe(input);
  });
});
