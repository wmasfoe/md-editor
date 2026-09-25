import { describe, expect, it } from "vitest";

import {
  computeDirtyState,
  createBuiltInEditorFeature,
  createAiWritingFeature,
  createCommandRegistry,
  collectRawFragments,
  createDocumentState,
  createEditorContent,
  createFeatureRegistry,
  createKeymapRegistry,
  getRawFragmentSaveSource,
  markSaved,
  normalizeMarkdownForComparison,
  RawFragmentRangeError,
  roundTripMarkdownFixture,
  serializeWithRawFragments,
  serializeEditorContent,
  updateRawMarkdown,
  type RawFragment,
} from "./index.ts";

describe("editor-core AI writing feature", () => {
  it("registers the AI writing commands and keymaps as a built-in feature", async () => {
    const commands = createCommandRegistry();
    const keymaps = createKeymapRegistry();
    let continueCalled = false;
    let fixCalled = false;

    createAiWritingFeature().setup({ commands, keymaps });

    expect(keymaps.list()).toContainEqual({
      id: "ai.continueWriting",
      key: "Mod-Shift-A",
      commandId: "ai.continueWriting",
    });
    expect(keymaps.list()).toContainEqual({
      id: "ai.fixGrammar",
      key: "Mod-Shift-G",
      commandId: "ai.fixGrammar",
    });
    expect(
      await commands.dispatch("ai.continueWriting", {
        document: createDocumentState(),
        actions: {
          continueAiWriting: () => {
            continueCalled = true;
          },
        },
      }),
    ).toBe(true);
    expect(continueCalled).toBe(true);

    expect(
      await commands.dispatch("ai.fixGrammar", {
        document: createDocumentState(),
        actions: {
          fixAiGrammar: () => {
            fixCalled = true;
          },
        },
      }),
    ).toBe(true);
    expect(fixCalled).toBe(true);
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
    expect(result.document.blocks.map((block) => block.type)).toEqual(["list", "thematicBreak"]);
  });
});

describe("raw fragment preservation", () => {
  it("collects byte-equal raw fragments for M0 preservation risks", () => {
    const markdown = [
      "---",
      "# keep comment",
      'title:  "Spacing"',
      "date: 2026-06-06",
      "---",
      "",
      "import Demo from './Demo.mdx'",
      "export const value = 1",
      "",
      "{value + 1}",
      "",
      '<div class="raw">',
      "  HTML stays raw.",
      "</div>",
      "",
      '<UnknownCard prop = " spaced " />',
      "",
      'Paragraph with <InlineThing value="x" /> and {inlineValue}.',
      "",
      '```ts {1,3} title="demo.ts"',
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
    const markdown = '---\r\ntitle:  "Spacing"\r\n---\r\n\r\nBody\r\n';
    const fragment = collectRawFragments(markdown).rawFragments[0];

    if (fragment === undefined) {
      throw new Error("Expected frontmatter fragment");
    }

    expect(fragment.kind).toBe("frontmatter");
    expect(fragment.rawSource).toBe('---\r\ntitle:  "Spacing"\r\n---\r\n');
    expect(serializeWithRawFragments(markdown, [fragment])).toBe(markdown);
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
      id: "mdx-1",
      kind: "unknownMdxFlow",
      rawSource: '<Widget type="info">Old</Widget>',
      dirty: true,
      serializedMarkdown: '<Widget type="warning">New</Widget>',
    };

    expect(getRawFragmentSaveSource(fragment)).toBe('<Widget type="warning">New</Widget>');
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
      "file.openRecent",
      "file.openFolder",
      "file.save",
      "file.saveAs",
      "settings.open",
      "mdx.openComponentMenu",
      "table.insert",
      "view.toggleSource",
      "view.toggleFocusMode",
      "view.toggleTypewriterMode",
      "view.showWysiwyg",
      "view.toggleSidebarPrimary",
    ]);
    expect(keymaps.list().map((keymap) => `${keymap.key}:${keymap.commandId}`)).toContain(
      "Mod-Shift-B:view.toggleSidebarPrimary",
    );
    expect(keymaps.list().map((keymap) => `${keymap.key}:${keymap.commandId}`)).toContain(
      "Mod-,:settings.open",
    );
    expect(keymaps.list().map((keymap) => `${keymap.key}:${keymap.commandId}`)).toContain(
      "Mod-Shift-M:mdx.openComponentMenu",
    );
    expect(keymaps.list().map((keymap) => `${keymap.key}:${keymap.commandId}`)).toContain(
      "Mod-Alt-T:table.insert",
    );

    await commands.dispatch("table.insert", {
      document: createDocumentState(),
      actions: {
        openInsertTableDialog: () => {
          calls.push("insert-table");
        },
      },
    });

    await commands.dispatch("mdx.openComponentMenu", {
      document: createDocumentState(),
      actions: {
        openMdxComponentMenu: () => {
          calls.push("mdx-menu");
        },
      },
    });

    expect(calls).toEqual(["insert-table", "mdx-menu"]);
  });
});
