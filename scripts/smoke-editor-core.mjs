import assert from "node:assert/strict";
import { calloutPlugin } from "../packages/mdx-plugins/src/metadata.ts";

import {
  RawFragmentRangeError,
  collectRawFragments,
  createEditorContent,
  createInMemoryMarkdownFileStore,
  loadMarkdownFile,
  markCalloutDirty,
  markSaved,
  normalizeMarkdownForComparison,
  parseCalloutFragment,
  persistMarkdownFile,
  reloadMarkdownFile,
  roundTripMarkdownFixture,
  serializeCalloutNode,
  serializeEditorContent,
  serializeWithRawFragments,
  smokeCalloutExtension,
  updateFileSessionRawMarkdown,
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
  "title:  \"Spacing\"\r\n",
  "---\r\n",
  "\r\n",
  "<Callout type=\"info\">Keep **this**.</Callout>\r\n",
  "\r\n",
  "<UnknownCard prop=\"x\" />\r\n",
].join("");
const rawResult = collectRawFragments(rawMarkdown);
assert.equal(serializeWithRawFragments(rawMarkdown, rawResult.rawFragments), rawMarkdown);
assert.deepEqual(
  rawResult.rawFragments.map((fragment) => fragment.kind),
  ["frontmatter", "registeredMdxComponent", "unknownMdxFlow"],
);

const callout = parseCalloutFragment(rawResult.rawFragments[1]);
assert.ok(callout);
assert.equal(calloutPlugin.component.name, "Callout");
assert.equal(calloutPlugin.component.packageName, "@md-editor/mdx-plugins");
assert.equal(serializeCalloutNode(callout, rawResult.rawFragments[1]), rawResult.rawFragments[1].rawSource);
assert.equal(
  serializeCalloutNode(
    markCalloutDirty(callout, { props: { type: "warning" }, childrenMarkdown: "Changed" }),
    rawResult.rawFragments[1],
  ),
  '<Callout type="warning">Changed</Callout>',
);
assert.equal(smokeCalloutExtension().status, "blocked");
assert.equal(
  smokeCalloutExtension({
    name: "headless-smoke-adapter",
    canRepresentCalloutNode: true,
    canSerializeCalloutNode: true,
  }).status,
  "passed",
);

assert.throws(
  () => serializeWithRawFragments(`Inserted\n${rawMarkdown}`, rawResult.rawFragments),
  RawFragmentRangeError,
);

const store = createInMemoryMarkdownFileStore({ "/notes/example.md": "# Saved\n" });
const loaded = await loadMarkdownFile(store, "/notes/example.md");
const edited = updateFileSessionRawMarkdown(loaded, "# Saved\n\nNew paragraph.\n");
assert.equal(edited.content.dirty, true);
const saved = await persistMarkdownFile(store, edited);
const reloaded = await reloadMarkdownFile(store, saved);
assert.equal(reloaded.content.rawMarkdown, "# Saved\n\nNew paragraph.\n");
assert.equal(reloaded.content.savedRawMarkdown, "# Saved\n\nNew paragraph.\n");
assert.equal(reloaded.content.dirty, false);

console.log("editor-core smoke passed");
