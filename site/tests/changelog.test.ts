import { describe, expect, it } from "vitest";
import { extractPrNumbers, parseChangelog } from "../lib/changelog";

describe("parseChangelog", () => {
  it("parses version sections in order", () => {
    const entries = parseChangelog(`# Changelog

## 0.3.17 - 2026-07-10

- Added website.
- Fixed release notes.

## 0.3.16 - 2026-07-09

- Previous release.
`);

    expect(entries).toEqual([
      {
        version: "0.3.17",
        date: "2026-07-10",
        items: [{ text: "Added website." }, { text: "Fixed release notes." }],
      },
      {
        version: "0.3.16",
        date: "2026-07-09",
        items: [{ text: "Previous release." }],
      },
    ]);
  });

  it("parses nested bullet items correctly", () => {
    const markdown = `# Changelog

## 0.8.0 - 2026-09-07 (#49)

- 新增 LaTeX 数学公式原生支持：
  - 支持行内公式（\`$E=mc^2$\`）与独立公式块（\`$$...$$\`）
  - 支持标准代码块语法
- 新增 Mermaid 图表可视化支持：
  - 原生渲染流程图
- 优化排版
`;

    const entries = parseChangelog(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("0.8.0");
    expect(entries[0].date).toBe("2026-09-07");
    expect(entries[0].sourcePR).toEqual([49]);
    expect(entries[0].items).toEqual([
      {
        text: "新增 LaTeX 数学公式原生支持：",
        items: [
          { text: "支持行内公式（`$E=mc^2$`）与独立公式块（`$$...$$`）" },
          { text: "支持标准代码块语法" },
        ],
      },
      {
        text: "新增 Mermaid 图表可视化支持：",
        items: [{ text: "原生渲染流程图" }],
      },
      {
        text: "优化排版",
      },
    ]);
  });

  it("extracts PR numbers in various formats from header", () => {
    const md = `
## 1.0.0 - 2026-09-01 (#10)
- item

## 1.1.0 - 2026-09-02 (PR #11)
- item

## 1.2.0 - 2026-09-03 (#12, #13)
- item
`;
    const entries = parseChangelog(md);
    expect(entries[0].sourcePR).toEqual([10]);
    expect(entries[1].sourcePR).toEqual([11]);
    expect(entries[2].sourcePR).toEqual([12, 13]);
  });

  it("ignores malformed sections without list items", () => {
    expect(parseChangelog("# Changelog\n\n## Draft\n\nNo bullets yet.\n")).toEqual([]);
  });
});

describe("extractPrNumbers", () => {
  it("extracts unique positive integers", () => {
    expect(extractPrNumbers("#49")).toEqual([49]);
    expect(extractPrNumbers("PR #49")).toEqual([49]);
    expect(extractPrNumbers("#48, #49")).toEqual([48, 49]);
    expect(extractPrNumbers("#48, #48")).toEqual([48]);
    expect(extractPrNumbers("no pr here")).toEqual([]);
    expect(extractPrNumbers(undefined)).toEqual([]);
  });
});
