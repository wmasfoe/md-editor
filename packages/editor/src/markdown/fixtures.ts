export type M1MarkdownFixtureKind = "combined" | "malformed" | "partial";
export type M2CodeBlockFixtureKind = "fenced" | "indented" | "malformed" | "partial";
export type M3TableFixtureKind =
  "aligned" | "minimal" | "no-leading-pipes" | "sparse" | "inline-content" | "no-body";

export interface M1MarkdownFixture {
  readonly id: string;
  readonly kind: M1MarkdownFixtureKind;
  readonly markdown: string;
  readonly requiredSourceFragments: readonly string[];
  readonly deferredSourceFragments: readonly string[];
}

export interface M2CodeBlockFixture {
  readonly id: string;
  readonly kind: M2CodeBlockFixtureKind;
  readonly markdown: string;
}

export interface M2CodeBlockPerformanceFixture {
  readonly id: "M2C-F18";
  readonly markdown: string;
  readonly fencedBlockCount: 51;
  readonly regularBlockCount: 50;
  readonly regularBodyLineCount: 200;
  readonly hugeBodyLineCount: 20_000;
}

export interface M3TableFixture {
  readonly id: string;
  readonly kind: M3TableFixtureKind;
  readonly markdown: string;
  readonly columnCount: number;
  readonly bodyRowCount: number;
  readonly hasLeadingPipes: boolean;
  readonly alignments: readonly ("left" | "center" | "right" | "none")[];
}

function defineFixture(fixture: M1MarkdownFixture): M1MarkdownFixture {
  return Object.freeze({
    ...fixture,
    requiredSourceFragments: Object.freeze([...fixture.requiredSourceFragments]),
    deferredSourceFragments: Object.freeze([...fixture.deferredSourceFragments]),
  });
}

function defineCodeBlockFixture(fixture: M2CodeBlockFixture): M2CodeBlockFixture {
  return Object.freeze({ ...fixture });
}

function defineTableFixture(fixture: M3TableFixture): M3TableFixture {
  return Object.freeze({ ...fixture, alignments: Object.freeze([...fixture.alignments]) });
}

export const M1_MARKDOWN_FIXTURES: readonly M1MarkdownFixture[] = Object.freeze([
  defineFixture({
    id: "combined-m1-document",
    kind: "combined",
    markdown: `---
title: "M1 fixture"
tags:
  - editor
---

# Active heading

Paragraph with **bold**, *italic*, ~~strike~~, and \`inline * code\`.

> Quote with [label](https://example.com "title").

- unordered
  1. ordered
  - [ ] pending
  - [x] done

![alt](./image.png "caption")

---

Setext heading
==============

<https://example.com>

https://bare.example/path

[reference][ref]

[ref]: https://example.com "Reference"

[^note]

[^note]: Footnote body

\`\`\`ts
const raw = "<html />";
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

<div>raw html</div>

<Component />
`,
    requiredSourceFragments: [
      "# Active heading",
      "**bold**",
      "*italic*",
      "~~strike~~",
      "`inline * code`",
      "> Quote",
      "- [ ] pending",
      '[label](https://example.com "title")',
      '![alt](./image.png "caption")',
      "Setext heading",
      "<https://example.com>",
      "https://bare.example/path",
      "[reference][ref]",
      "[^note]",
      "[^note]: Footnote body",
    ],
    deferredSourceFragments: ["```ts", "| a | b |", "<div>raw html</div>", "<Component />"],
  }),
  defineFixture({
    id: "malformed-inline-and-block",
    kind: "malformed",
    markdown: `# Valid before malformed

**unterminated bold

[broken link](<unterminated

![broken image](./missing.png "unterminated

\`unterminated code

~~unterminated strike
`,
    requiredSourceFragments: [
      "**unterminated bold",
      "[broken link](<unterminated",
      "![broken image]",
      "`unterminated code",
      "~~unterminated strike",
    ],
    deferredSourceFragments: [],
  }),
  defineFixture({
    id: "unterminated-frontmatter",
    kind: "malformed",
    markdown: `---
title: [unterminated
tags:
  - one
`,
    requiredSourceFragments: ["---", "title: [unterminated"],
    deferredSourceFragments: [],
  }),
  defineFixture({
    id: "partial-typing-states",
    kind: "partial",
    markdown: `#

- [

[la

![al

~~

\`
`,
    requiredSourceFragments: ["#", "- [", "[la", "![al", "~~", "`"],
    deferredSourceFragments: [],
  }),
]);

export const M2_CODE_BLOCK_FIXTURES: readonly M2CodeBlockFixture[] = Object.freeze([
  defineCodeBlockFixture({
    id: "M2C-F01",
    kind: "fenced",
    markdown: "```\nplain body\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F02",
    kind: "fenced",
    markdown: "~~~~ts\nconst value = 1;\n~~~~\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F05",
    kind: "fenced",
    markdown: "```ts meta=1 keep\nconst value = 1;\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F05B",
    kind: "fenced",
    markdown: "```   ts meta=1\nbody\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F06",
    kind: "fenced",
    markdown: "````\n``` remains body\n````\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F07",
    kind: "indented",
    markdown: "    first\n      second\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F08",
    kind: "indented",
    markdown: "    first\n\n      second\n    third\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F09",
    kind: "fenced",
    markdown: "```\n\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F09B",
    kind: "fenced",
    markdown: "```\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F11",
    kind: "partial",
    markdown: "```ts\nno closing fence\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F12",
    kind: "malformed",
    markdown: "~~~ts\nbody\n```\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F13",
    kind: "fenced",
    markdown: "before\n\n```js\none\n```\n\n```py\ntwo\n```\n\nafter\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F14",
    kind: "indented",
    markdown: "- item\n\n        nested\n        code\n",
  }),
  defineCodeBlockFixture({
    id: "M2C-F16",
    kind: "fenced",
    markdown: '```ts\nconst café = "☕️";\n```\n',
  }),
]);

export function getM1MarkdownFixture(id: string): M1MarkdownFixture {
  const fixture = M1_MARKDOWN_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown M1 Markdown fixture: ${id}`);
  }
  return fixture;
}

export function getM2CodeBlockFixture(id: string): M2CodeBlockFixture {
  const fixture = M2_CODE_BLOCK_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown M2 code-block fixture: ${id}`);
  }
  return fixture;
}

export const M3_TABLE_FIXTURES: readonly M3TableFixture[] = Object.freeze([
  defineTableFixture({
    id: "M3T-F01",
    kind: "aligned",
    markdown: "| left | center | right |\n| :--- | :----: | ---: |\n| a | b | c |\n| d | e | f |\n",
    columnCount: 3,
    bodyRowCount: 2,
    hasLeadingPipes: true,
    alignments: ["left", "center", "right"],
  }),
  defineTableFixture({
    id: "M3T-F02",
    kind: "minimal",
    markdown: "| a | b |\n| - | - |\n| 1 | 2 |\n",
    columnCount: 2,
    bodyRowCount: 1,
    hasLeadingPipes: true,
    alignments: ["none", "none"],
  }),
  defineTableFixture({
    id: "M3T-F03",
    kind: "no-leading-pipes",
    markdown: "left | center | right\n:--- | :----: | ---:\na | b | c\n",
    columnCount: 3,
    bodyRowCount: 1,
    hasLeadingPipes: false,
    alignments: ["left", "center", "right"],
  }),
  defineTableFixture({
    id: "M3T-F04",
    kind: "sparse",
    markdown: "| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 |\n",
    columnCount: 3,
    bodyRowCount: 2,
    hasLeadingPipes: true,
    alignments: ["none", "none", "none"],
  }),
  defineTableFixture({
    id: "M3T-F05",
    kind: "inline-content",
    markdown: [
      "| feature | status |",
      "| --- | --- |",
      "| **bold** | *italic* |",
      "| [link](https://example.com) | `code` |",
      "",
    ].join("\n"),
    columnCount: 2,
    bodyRowCount: 2,
    hasLeadingPipes: true,
    alignments: ["none", "none"],
  }),
  defineTableFixture({
    id: "M3T-F06",
    kind: "no-body",
    markdown: "| header |\n| --- |\n",
    columnCount: 1,
    bodyRowCount: 0,
    hasLeadingPipes: true,
    alignments: ["none"],
  }),
]);

export function getM3TableFixture(id: string): M3TableFixture {
  const fixture = M3_TABLE_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown M3 table fixture: ${id}`);
  }
  return fixture;
}

let performanceFixture: M2CodeBlockPerformanceFixture | null = null;

export function getM2CodeBlockPerformanceFixture(): M2CodeBlockPerformanceFixture {
  if (performanceFixture) {
    return performanceFixture;
  }
  const blocks: string[] = [];
  for (let block = 0; block < 50; block += 1) {
    const blockId = String(block).padStart(3, "0");
    const lines = Array.from(
      { length: 200 },
      (_, line) => `regular-${blockId}-line-${String(line).padStart(3, "0")}`,
    );
    blocks.push(["```text", ...lines, "```"].join("\n"));
  }
  const hugeLines = Array.from(
    { length: 20_000 },
    (_, line) => `huge-line-${String(line).padStart(5, "0")}`,
  );
  blocks.push(["```text", ...hugeLines, "```"].join("\n"));
  performanceFixture = Object.freeze({
    id: "M2C-F18",
    markdown: `${blocks.join("\n\n")}\n`,
    fencedBlockCount: 51,
    regularBlockCount: 50,
    regularBodyLineCount: 200,
    hugeBodyLineCount: 20_000,
  });
  return performanceFixture;
}
