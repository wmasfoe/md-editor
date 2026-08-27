import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/../src/markdown/extensions.ts";
import { buildMarkdownRangeIndex, mdxModeFacet } from "../../src/../src/markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../../src/../src/markdown/range-types.ts";

function buildRecords(source: string): readonly MarkdownRangeRecord[] {
  const state = EditorState.create({
    doc: source,
    extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), mdxModeFacet.of(true)],
  });
  return buildMarkdownRangeIndex(source, syntaxTree(state), { mdxMode: true }).records;
}

function byKind(
  records: readonly MarkdownRangeRecord[],
  kind: string,
): readonly MarkdownRangeRecord[] {
  return records.filter((record) => record.kind === kind);
}

describe("MDX range-index 集成", () => {
  it("C1: 块级 MDX 组件产生 mdx-jsx record", () => {
    const source = ['<Callout type="info">', "body", "</Callout>", "", "plain"].join("\n");
    const mdx = byKind(buildRecords(source), "mdx-jsx");
    expect(mdx).toHaveLength(1);
    const record = mdx[0];
    if (!record) {
      throw new Error("Expected an mdx-jsx record.");
    }
    expect(record.fullRange.from).toBe(0);
    expect(source.slice(record.fullRange.from, record.fullRange.to)).toContain("</Callout>");
    expect(record.fullRange.to).toBeLessThanOrEqual(source.indexOf("plain"));
    expect(record.renderPolicy).toBe("mdx-widget");
  });

  it("C6: mdx-jsx 与 html/table 边界不重叠", () => {
    const source = [
      '<Callout type="info">',
      "body",
      "</Callout>",
      "",
      "<div>html</div>",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const records = buildRecords(source);
    const mdx = byKind(records, "mdx-jsx");
    const html = byKind(records, "html");
    const tables = byKind(records, "table");

    expect(mdx).toHaveLength(1);
    expect(html).toHaveLength(1);
    expect(tables).toHaveLength(1);

    const mdxRange = mdx[0]?.fullRange;
    const htmlRange = html[0]?.fullRange;
    if (!mdxRange || !htmlRange) {
      throw new Error("Missing ranges.");
    }
    // 不重叠:mdx 在前,html 在后
    expect(mdxRange.to).toBeLessThanOrEqual(htmlRange.from);
    // `<Callout>` 不应再被当作 HTML 记录(避免双重投影)
    expect(htmlRange.from).toBeGreaterThan(mdxRange.to);
  });

  it("C2: 未注册组件也产生 record(投影层决定占位)", () => {
    const source = ["<Unknown>raw</Unknown>", "", "plain"].join("\n");
    const mdx = byKind(buildRecords(source), "mdx-jsx");
    expect(mdx).toHaveLength(1);
    expect(mdx[0]?.nodeName).toBe("mdx-jsx:Unknown");
  });

  it("A5: 小写 script 标签不产生 mdx-jsx record", () => {
    const source = "<script>alert(1)</script>";
    const records = buildRecords(source);
    expect(byKind(records, "mdx-jsx")).toHaveLength(0);
  });

  it("C1-n: 表达式属性不产生 mdx-jsx record(整元素丢弃)", () => {
    const source = "<Callout title={1+1}>x</Callout>";
    expect(byKind(buildRecords(source), "mdx-jsx")).toHaveLength(0);
  });
});
