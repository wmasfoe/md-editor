import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { Tree, TreeCursor } from "@lezer/common";
import { parser as markdownParser } from "@lezer/markdown";
import { parser as yamlParser } from "@lezer/yaml";
import { createDocumentState, switchEditorModeSafely } from "@md-editor/editor-core";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_FIXTURES, getM1MarkdownFixture } from "./fixtures.ts";
import { M1_MARKDOWN_EXTENSIONS } from "./extensions.ts";
import type { CodeMirrorRenderer } from "../renderer.ts";
import { createRendererTestHarness } from "../testing.ts";

function collectNodeNames(tree: Tree): ReadonlySet<string> {
  const names = new Set<string>();
  const cursor: TreeCursor = tree.cursor();
  do {
    names.add(cursor.name);
  } while (cursor.next());
  return names;
}

function createCombinedFixtureHarness() {
  const fixture = getM1MarkdownFixture("combined-m1-document");
  const document = createDocumentState({ markdown: fixture.markdown });
  let renderer: CodeMirrorRenderer | null = null;
  document.subscribeTransitions((event) => {
    renderer?.sync(event);
  });
  const harness = createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
  renderer = harness.renderer;
  return { document, harness };
}

describe("M1 Markdown fixture baseline", () => {
  it("freezes combined, malformed, and partial source inventories", () => {
    expect(M1_MARKDOWN_FIXTURES.map((fixture) => fixture.kind)).toEqual([
      "combined",
      "malformed",
      "malformed",
      "partial",
    ]);
    for (const fixture of M1_MARKDOWN_FIXTURES) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.requiredSourceFragments)).toBe(true);
      for (const fragment of fixture.requiredSourceFragments) {
        expect(fixture.markdown).toContain(fragment);
      }
    }
  });

  it("locks the direct CodeMirror, Markdown, Lezer, and YAML parser APIs", () => {
    const combined = getM1MarkdownFixture("combined-m1-document");
    const state = EditorState.create({ doc: combined.markdown, extensions: markdown() });
    expect(syntaxTree(state).length).toBe(combined.markdown.length);

    const nodeNames = collectNodeNames(
      markdownParser.configure(M1_MARKDOWN_EXTENSIONS).parse(combined.markdown),
    );
    for (const requiredName of [
      "ATXHeading1",
      "StrongEmphasis",
      "Emphasis",
      "Strikethrough",
      "InlineCode",
      "Blockquote",
      "BulletList",
      "OrderedList",
      "Task",
      "Link",
      "Image",
      "HorizontalRule",
      "SetextHeading1",
      "Autolink",
      "FencedCode",
      "Table",
    ]) {
      expect(nodeNames.has(requiredName), `missing parser node ${requiredName}`).toBe(true);
    }

    const yaml = "title: M1 fixture\ntags:\n  - editor\n";
    expect(yamlParser.parse(yaml).length).toBe(yaml.length);
  });

  it("keeps one view and state epoch across new-fixture mode paths", () => {
    const { document, harness } = createCombinedFixtureHarness();
    const before = harness.probe();
    for (let index = 0; index < 50; index += 1) {
      const result = switchEditorModeSafely(document, index % 2 === 0 ? "source" : "wysiwyg", {
        operationId: `m1-baseline:${index}`,
        renderer: harness.renderer,
      });
      expect(result.ok).toBe(true);
    }
    const after = harness.probe();
    expect(after.viewId).toBe(before.viewId);
    expect(after.stateEpochId).toBe(before.stateEpochId);
    expect(after.rootExtensionId).toBe(before.rootExtensionId);
    expect(after.explicitStateCreationCount).toBe(before.explicitStateCreationCount);
    expect(after.markdown).toBe(before.markdown);
  });

  it("exposes an immutable projection foundation diagnostics baseline", () => {
    const { harness } = createCombinedFixtureHarness();
    const probe = harness.probe();
    expect(Object.isFrozen(probe)).toBe(true);
    expect(Object.isFrozen(probe.wysiwyg)).toBe(true);
    expect(Object.isFrozen(probe.wysiwyg.widgetLifecycleCounts)).toBe(true);
    expect(Object.isFrozen(probe.wysiwyg.safeFallbackDiagnosticCounts)).toBe(true);
    expect(probe.wysiwyg).toMatchObject({
      fullIndexBuildCount: 1,
      dirtyBlockRebuildCount: 0,
      mappedRangeCount: 0,
      selectionDeltaUpdateCount: 0,
      layoutDecorationReplaceCount: 1,
      visibleMarkBuildCount: 0,
      parseCoverageRefreshCount: 0,
      safeFallbackDiagnosticCodes: [],
    });
    expect(Object.isFrozen(probe.wysiwygProjection)).toBe(true);
    expect(Object.isFrozen(probe.wysiwygProjection.activeSyntaxIds)).toBe(true);
    expect(Object.isFrozen(probe.wysiwygProjection.protectedRanges)).toBe(true);
  });
});

describe("M1 behavior red baseline", () => {
  it("builds the initial parser range index in WYSIWYG mode", () => {
    const { harness } = createCombinedFixtureHarness();
    expect(harness.probe().wysiwyg.fullIndexBuildCount).toBe(1);
  });

  it("installs layout projection work for the combined fixture", () => {
    const { harness } = createCombinedFixtureHarness();
    expect(harness.probe().wysiwyg.layoutDecorationReplaceCount).toBeGreaterThan(0);
    expect(harness.probe().wysiwygProjection.layoutDecorationCount).toBeGreaterThan(0);
    expect(harness.probe().wysiwygProjection.atomicRangeCount).toBeGreaterThan(0);
  });
});
