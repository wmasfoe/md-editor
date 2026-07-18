export type M1MarkdownFixtureKind = "combined" | "malformed" | "partial";

export interface M1MarkdownFixture {
  readonly id: string;
  readonly kind: M1MarkdownFixtureKind;
  readonly markdown: string;
  readonly requiredSourceFragments: readonly string[];
  readonly deferredSourceFragments: readonly string[];
}

function defineFixture(fixture: M1MarkdownFixture): M1MarkdownFixture {
  return Object.freeze({
    ...fixture,
    requiredSourceFragments: Object.freeze([...fixture.requiredSourceFragments]),
    deferredSourceFragments: Object.freeze([...fixture.deferredSourceFragments]),
  });
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

export function getM1MarkdownFixture(id: string): M1MarkdownFixture {
  const fixture = M1_MARKDOWN_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown M1 Markdown fixture: ${id}`);
  }
  return fixture;
}
