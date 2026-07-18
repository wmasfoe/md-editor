import { parser as markdownParser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "./extensions.ts";
import { buildMarkdownRangeIndex } from "./range-index.ts";

function sourceForKind(
  source: string,
  kind: Parameters<ReturnType<typeof buildIndex>["byKind"]>[0],
) {
  return buildIndex(source)
    .byKind(kind)
    .map((record) => source.slice(record.fullRange.from, record.fullRange.to));
}

function buildIndex(source: string) {
  const tree = markdownParser.configure(M1_MARKDOWN_EXTENSIONS).parse(source);
  return buildMarkdownRangeIndex(source, tree);
}

describe("M1 Markdown parser extensions", () => {
  it("assigns explicit policies to every supported default visualization form", () => {
    const source = [
      "Setext title",
      "============",
      "",
      "<https://explicit.example> and https://bare.example/path.",
      "",
      "[label][ref] and ![alt][image-ref]",
      "",
      '[ref]: /target "Title"',
      "[image-ref]: image.png",
      "",
      "[^note]",
      "",
      "[^note]: Footnote body",
      "",
    ].join("\n");
    const index = buildIndex(source);

    expect(sourceForKind(source, "heading-setext")).toEqual(["Setext title\n============"]);
    expect(sourceForKind(source, "autolink")).toEqual([
      "<https://explicit.example>",
      "https://bare.example/path",
    ]);
    expect(sourceForKind(source, "reference-link")).toEqual(["[label][ref]"]);
    expect(sourceForKind(source, "reference-image")).toEqual(["![alt][image-ref]"]);
    expect(sourceForKind(source, "reference-definition")).toEqual([
      '[ref]: /target "Title"',
      "[image-ref]: image.png",
    ]);
    expect(sourceForKind(source, "footnote")).toEqual(["[^note]", "[^note]: Footnote body"]);
    for (const record of index.records.filter(
      (candidate) => candidate.renderPolicy === "source-only-atom",
    )) {
      expect(record).toMatchObject({
        editPolicy: "source-mode-only",
        interactionPolicy: "source-mode-required",
        parserCoverage: "complete",
      });
    }
  });

  it("leaves malformed and unsupported footnote shapes unclaimed", () => {
    const source = [
      "[^bad label]",
      "[^]",
      "[^unterminated",
      "[^bad label]: body",
      "[^]: body",
      "",
    ].join("\n");
    expect(buildIndex(source).byKind("footnote")).toEqual([]);
  });

  it("keeps deferred and unknown syntax raw even when it contains atom-like text", () => {
    const source = [
      "```md",
      "[^note] https://inside.example [label][ref]",
      "```",
      "",
      "| value |",
      "| --- |",
      "| [^note] |",
      "",
      "<div>[^note]</div>",
      "",
      '<Component value="[^note]" />',
      "",
    ].join("\n");
    const index = buildIndex(source);

    expect(index.byKind("footnote")).toEqual([]);
    expect(index.byKind("autolink")).toEqual([]);
    expect(index.byKind("deferred-code")).toHaveLength(1);
    expect(index.byKind("deferred-table")).toHaveLength(1);
    expect(index.byKind("deferred-html").length).toBeGreaterThanOrEqual(1);
    expect(index.records.filter((record) => record.renderPolicy === "source-only-atom")).toEqual(
      [],
    );
  });
});
