import assert from "node:assert/strict";

import {
  RawFragmentRangeError,
  collectRawFragments,
  createEditorContent,
  markSaved,
  normalizeMarkdownForComparison,
  roundTripMarkdownFixture,
  serializeEditorContent,
  serializeWithRawFragments,
  updateRawMarkdown,
} from "../packages/editor-core/src/index.ts";

assert.equal(normalizeMarkdownForComparison("A  \r\n\r\n\r\nB\t\n"), "A\n\nB\n");
assert.equal(roundTripMarkdownFixture("# Heading\n\nText\n").normalizedEqual, true);

const content = createEditorContent({
  rawMarkdown: "# Current\n",
  savedRawMarkdown: "# Saved\n",
});
assert.equal(content.dirty, true);
assert.deepEqual(serializeEditorContent(content), {
  rawMarkdown: "# Current\n",
  rawFragments: [],
  dirty: true,
  saveAuthority: "rawMarkdown",
});
assert.equal(markSaved(updateRawMarkdown(content, "# Current\n\nNew\n")).dirty, false);

const rawMarkdown = [
  "---\r\n",
  'title:  "Spacing"\r\n',
  "---\r\n",
  "\r\n",
  '<Callout type="info">Keep **this**.</Callout>\r\n',
  "\r\n",
  '<UnknownCard prop="x" />\r\n',
].join("");
const rawResult = collectRawFragments(rawMarkdown);
assert.equal(serializeWithRawFragments(rawMarkdown, rawResult.rawFragments), rawMarkdown);
assert.deepEqual(
  rawResult.rawFragments.map((fragment) => fragment.kind),
  ["frontmatter", "unknownMdxFlow", "unknownMdxFlow"],
);

assert.throws(
  () => serializeWithRawFragments(`Inserted\n${rawMarkdown}`, rawResult.rawFragments),
  RawFragmentRangeError,
);

console.log("editor-core smoke passed");
