import { describe, expect, it } from "vitest";

import {
  calloutDescriptor,
  computeDirtyState,
  createBuiltInEditorFeature,
  createCommandRegistry,
  collectRawFragments,
  createDocumentState,
  createEditorContent,
  createFeatureRegistry,
  describeEditorCoreSpike,
  createInMemoryMarkdownFileStore,
  createKeymapRegistry,
  getRawFragmentSaveSource,
  loadMarkdownFile,
  markSaved,
  markCalloutDirty,
  normalizeMarkdownForComparison,
  parseCalloutFragment,
  persistMarkdownFile,
  RawFragmentRangeError,
  reloadMarkdownFile,
  roundTripMarkdownFixture,
  serializeCalloutNode,
  serializeWithRawFragments,
  serializeEditorContent,
  smokeCalloutExtension,
  updateFileSessionRawMarkdown,
  updateRawMarkdown,
  type RawFragment,
} from "./index.ts";

describe("editor-core M0 skeleton", () => {
  it("loads the headless editor-core package", () => {
    expect(describeEditorCoreSpike()).toBe("editor-core-m0");
  });
});

describe("Markdown normalized round-trip fixtures", () => {
  it("documents the normalization helper", () => {
    expect(normalizeMarkdownForComparison("A  \r\n\r\n\r\nB\t\n")).toBe("A\n\nB\n");
  });

  it("round-trips common Markdown with normalized equality", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph with *emphasis*, **strong**, and [a link](https://example.com).",
      "",
      "- First item",
      "- Second item",
      "",
      "> Quoted text",
      "",
      "![Alt text](./image.png)",
      "",
      "```ts meta",
      "const value = 1;",
      "```",
      "",
    ].join("\n");

    const result = roundTripMarkdownFixture(markdown);

    expect(result.normalizedEqual).toBe(true);
    expect(result.serializedMarkdown).toBe(markdown);
    expect(result.document.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "blockquote",
      "image",
      "codeFence",
    ]);
  });

  it("keeps ordered lists and thematic breaks in the parse seam", () => {
    const result = roundTripMarkdownFixture("1. One\n2. Two\n\n---\n");

    expect(result.normalizedEqual).toBe(true);
    expect(result.document.blocks.map((block) => block.type)).toEqual([
      "list",
      "thematicBreak",
    ]);
  });
});

describe("raw fragment preservation", () => {
  it("collects byte-equal raw fragments for M0 preservation risks", () => {
    const markdown = [
      "---",
      "# keep comment",
      "title:  \"Spacing\"",
      "date: 2026-06-06",
      "---",
      "",
      "import Demo from './Demo.mdx'",
      "export const value = 1",
      "",
      "{value + 1}",
      "",
      "<div class=\"raw\">",
      "  HTML stays raw.",
      "</div>",
      "",
      "<UnknownCard prop = \" spaced \" />",
      "",
      "Paragraph with <InlineThing value=\"x\" /> and {inlineValue}.",
      "",
      "```ts {1,3} title=\"demo.ts\"",
      "const value = '<Unknown />';",
      "```",
      "",
    ].join("\n");

    const result = collectRawFragments(markdown);

    expect(result.rawFragments.map((fragment) => fragment.kind)).toEqual([
      "frontmatter",
      "mdxEsm",
      "mdxEsm",
      "mdxExpression",
      "htmlBlock",
      "unknownMdxFlow",
      "unknownMdxText",
      "mdxExpression",
      "codeFence",
    ]);
    expect(serializeWithRawFragments(markdown, result.rawFragments)).toBe(markdown);
  });

  it("localizes dirty raw fragment replacement by source range", () => {
    const markdown = ["Before", "<UnknownCard old />", "After", ""].join("\n");
    const result = collectRawFragments(markdown);
    const fragment = result.rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected unknown MDX flow fragment");
    }

    expect(fragment?.rawSource).toBe("<UnknownCard old />\n");

    const serialized = serializeWithRawFragments(markdown, [
      {
        ...fragment,
        dirty: true,
        serializedMarkdown: "<UnknownCard new />",
      } satisfies RawFragment,
    ]);

    expect(serialized).toBe(["Before", "<UnknownCard new />", "After", ""].join("\n"));
  });

  it("fails explicitly instead of replacing a stale raw fragment range", () => {
    const markdown = ["Before", "<UnknownCard old />", "After", ""].join("\n");
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected unknown MDX flow fragment");
    }

    expect(() =>
      serializeWithRawFragments(`Inserted\n${markdown}`, [
        {
          ...fragment,
          dirty: true,
          serializedMarkdown: "<UnknownCard new />",
        } satisfies RawFragment,
      ]),
    ).toThrow(RawFragmentRangeError);
  });

  it("preserves CRLF frontmatter bytes", () => {
    const markdown = "---\r\ntitle:  \"Spacing\"\r\n---\r\n\r\nBody\r\n";
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected frontmatter fragment");
    }

    expect(fragment.kind).toBe("frontmatter");
    expect(fragment.rawSource).toBe("---\r\ntitle:  \"Spacing\"\r\n---\r\n");
    expect(serializeWithRawFragments(markdown, [fragment])).toBe(markdown);
  });
});

describe("internal Callout minimum slice", () => {
  it("defines the official Callout descriptor", () => {
    expect(calloutDescriptor).toMatchObject({
      name: "Callout",
      kind: "block",
      acceptsMarkdownChildren: true,
    });
    expect(calloutDescriptor.props.map((prop) => prop.name)).toEqual(["type", "title"]);
  });

  it("maps a registered Callout raw fragment to a structured node", () => {
    const markdown = '<Callout title="Heads up" type="warning">Read **this**.</Callout>\n';
    const result = collectRawFragments(markdown);
    const fragment = result.rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected registered Callout fragment");
    }

    expect(fragment.kind).toBe("registeredMdxComponent");
    expect(parseCalloutFragment(fragment)).toMatchObject({
      type: "callout",
      name: "Callout",
      props: {
        title: "Heads up",
        type: "warning",
      },
      childrenMarkdown: "Read **this**.",
      dirty: false,
    });
  });

  it("maps an indented Callout raw fragment to a structured node", () => {
    const markdown = '  <Callout type="info">Indented</Callout>\n';
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected registered Callout fragment");
    }

    expect(fragment.kind).toBe("registeredMdxComponent");
    expect(parseCalloutFragment(fragment)).toMatchObject({
      type: "callout",
      props: {
        type: "info",
      },
      childrenMarkdown: "Indented",
    });
  });

  it("preserves untouched Callout props, whitespace, and children", () => {
    const markdown = '<Callout  type = "info" title="Original">Keep  spacing</Callout>\n';
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected registered Callout fragment");
    }

    const node = parseCalloutFragment(fragment);

    if (node === undefined) {
      throw new Error("Expected Callout node");
    }

    expect(serializeCalloutNode(node, fragment)).toBe(fragment.rawSource);
  });

  it("uses serializer output after a structured Callout edit", () => {
    const markdown = '<Callout type="info">Old</Callout>\n';
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected registered Callout fragment");
    }

    const node = parseCalloutFragment(fragment);

    if (node === undefined) {
      throw new Error("Expected Callout node");
    }

    const dirtyNode = markCalloutDirty(node, {
      props: { type: "warning" },
      childrenMarkdown: "New",
    });

    expect(serializeCalloutNode(dirtyNode, fragment)).toBe(
      '<Callout type="warning">New</Callout>',
    );
  });

  it("records an explicit blocker when editor extension APIs are unavailable", () => {
    expect(smokeCalloutExtension()).toMatchObject({
      status: "blocked",
    });
    expect(
      smokeCalloutExtension({
        name: "headless-test-adapter",
        canRepresentCalloutNode: true,
        canSerializeCalloutNode: true,
      }),
    ).toEqual({
      status: "passed",
      adapterName: "headless-test-adapter",
    });
  });
});

describe("file lifecycle seam", () => {
  it("loads, updates, persists, reloads, and resets dirty against savedRawMarkdown", async () => {
    const store = createInMemoryMarkdownFileStore({
      "/notes/example.md": "# Saved\n",
    });

    const loaded = await loadMarkdownFile(store, "/notes/example.md");
    const edited = updateFileSessionRawMarkdown(loaded, "# Saved\n\nNew paragraph.\n");

    expect(loaded.content).toMatchObject({
      rawMarkdown: "# Saved\n",
      savedRawMarkdown: "# Saved\n",
      dirty: false,
    });
    expect(edited.content).toMatchObject({
      rawMarkdown: "# Saved\n\nNew paragraph.\n",
      savedRawMarkdown: "# Saved\n",
      dirty: true,
    });

    const saved = await persistMarkdownFile(store, edited);
    const reloaded = await reloadMarkdownFile(store, saved);

    expect(saved.content).toMatchObject({
      rawMarkdown: "# Saved\n\nNew paragraph.\n",
      savedRawMarkdown: "# Saved\n\nNew paragraph.\n",
      dirty: false,
    });
    expect(reloaded.content).toMatchObject({
      rawMarkdown: "# Saved\n\nNew paragraph.\n",
      savedRawMarkdown: "# Saved\n\nNew paragraph.\n",
      dirty: false,
    });
  });
});

describe("content authority contracts", () => {
  it("derives dirty state from rawMarkdown and savedRawMarkdown only", () => {
    const content = createEditorContent({
      rawMarkdown: "# Current\n",
      savedRawMarkdown: "# Saved\n",
    });

    expect(content.dirty).toBe(true);
    expect(computeDirtyState(content)).toBe(true);
  });

  it("keeps rawMarkdown as the serialize/save authority", () => {
    const content = createEditorContent({
      rawMarkdown: "# Current\n\n<Unknown />\n",
      savedRawMarkdown: "# Current\n",
    });

    expect(serializeEditorContent(content)).toEqual({
      rawMarkdown: "# Current\n\n<Unknown />\n",
      rawFragments: [],
      dirty: true,
      saveAuthority: "rawMarkdown",
    });
  });

  it("updates the current raw content without moving the saved baseline", () => {
    const saved = createEditorContent({ rawMarkdown: "# Saved\n" });
    const edited = updateRawMarkdown(saved, "# Saved\n\nNew paragraph.\n");

    expect(edited.savedRawMarkdown).toBe("# Saved\n");
    expect(edited.dirty).toBe(true);
  });

  it("resets dirty state only after a successful save baseline update", () => {
    const edited = createEditorContent({
      rawMarkdown: "# Current\n",
      savedRawMarkdown: "# Saved\n",
    });

    expect(markSaved(edited)).toMatchObject({
      rawMarkdown: "# Current\n",
      savedRawMarkdown: "# Current\n",
      dirty: false,
    });
  });

  it("preserves untouched raw fragments byte-for-byte", () => {
    const fragment: RawFragment = {
      id: "frontmatter-1",
      kind: "frontmatter",
      rawSource: "---\ntitle:  Test\n---\n",
      dirty: false,
      serializedMarkdown: "---\ntitle: Test\n---\n",
    };

    expect(getRawFragmentSaveSource(fragment)).toBe("---\ntitle:  Test\n---\n");
  });

  it("accepts serializer output only for dirty raw fragments", () => {
    const fragment: RawFragment = {
      id: "callout-1",
      kind: "registeredMdxComponent",
      rawSource: "<Callout type=\"info\">Old</Callout>",
      dirty: true,
      serializedMarkdown: "<Callout type=\"warning\">New</Callout>",
    };

    expect(getRawFragmentSaveSource(fragment)).toBe(
      "<Callout type=\"warning\">New</Callout>",
    );
  });
});

describe("built-in feature registry", () => {
  it("registers editor commands and keymaps through FeatureRegistry", async () => {
    const commands = createCommandRegistry();
    const keymaps = createKeymapRegistry();
    const features = createFeatureRegistry();
    const calls: string[] = [];

    features.register(createBuiltInEditorFeature());
    features.activateAll({ commands, keymaps });

    expect(commands.list().map((command) => command.id)).toEqual([
      "file.new",
      "file.open",
      "file.openFolder",
      "file.save",
      "file.saveAs",
      "view.toggleSource",
      "view.showWysiwyg",
      "view.toggleSidebarPrimary",
    ]);
    expect(keymaps.list().map((keymap) => `${keymap.key}:${keymap.commandId}`)).toContain(
      "Mod-Shift-1:view.toggleSidebarPrimary",
    );

    await commands.dispatch("view.toggleSidebarPrimary", {
      document: createDocumentState(),
      actions: {
        toggleSidebarPrimary: () => {
          calls.push("sidebar");
        },
      },
    });

    expect(calls).toEqual(["sidebar"]);
  });
});
