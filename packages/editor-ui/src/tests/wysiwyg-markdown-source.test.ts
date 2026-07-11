import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseMirrorNode, type NodeSpec } from "@milkdown/kit/prose/model";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Root } from "@milkdown/kit/transformer";
import {
  canStartWysiwygMarkdownSourceEdit,
  collectWysiwygMarkdownSourceDraftIds,
  createWysiwygMarkdownSourceSession,
  findWysiwygMarkdownSourceTarget,
  isWysiwygMarkdownImagePreviewReady,
  mapWysiwygMarkdownSourceSession,
  markWysiwygMarkdownSourceInvalid,
  mapTextOffsetToSource,
  extractWysiwygMarkdownSourceDrafts,
  prepareWysiwygMarkdownSourceDraftsForPreview,
  reconcileWysiwygMarkdownSourceDrafts,
  restoreWysiwygMarkdownSourceDraftsInTree,
  replaceWysiwygMarkdownSourceNodeWithParsed,
  replaceWysiwygMarkdownSourceTargetWithDraft,
  resolveWysiwygMarkdownSourceReplacement,
  setWysiwygMarkdownSourceComposition,
  shouldCommitWysiwygMarkdownSourceSession,
  updateWysiwygMarkdownSourceDraft,
  updateWysiwygMarkdownImagePreviewState,
  updateWysiwygMarkdownSourceNodeDraft,
  type WysiwygMarkdownSourceKind,
  type WysiwygMarkdownSourceDraft,
} from "../utils/wysiwyg-markdown-source";
import {
  createWysiwygImagePreviewRequestGate,
  createWysiwygMarkdownSourceProsePlugin,
  resolveWysiwygMarkdownImagePreview,
  wysiwygMarkdownSourcePluginKey,
} from "../utils/wysiwyg-markdown-source-plugin";

const schema = createSourceTestSchema();

describe("WYSIWYG Markdown source targets", () => {
  it("isolates headings and maps the document caret after the ATX marker", () => {
    const heading = schema.nodes.heading.create(
      { level: 2 },
      schema.text("Title", [schema.marks.strong.create()]),
    );
    const doc = schema.nodes.doc.create(null, heading);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });

    const target = findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument);

    expect(target).toMatchObject({
      kind: "heading",
      layout: "block",
      from: 0,
      to: heading.nodeSize,
      source: "## **Title**",
      sourceCursorOffset: 7,
    });
  });

  it.each([
    ["strong", "**value**"],
    ["emphasis", "*value*"],
    ["strikethrough", "~~value~~"],
    ["link", '[value](docs/readme.md "Docs")'],
    ["inlineCode", "`value`"],
  ] satisfies readonly [WysiwygMarkdownSourceKind, string][])(
    "isolates the complete %s source around the caret",
    (kind, expectedSource) => {
      const { state, markedFrom, markedTo } = createMarkedState(kind);

      const target = findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument);

      expect(target).toMatchObject({
        kind,
        layout: "inline",
        from: markedFrom,
        to: markedTo,
        source: expectedSource,
      });
      expect(target?.sourceCursorOffset).toBe(expectedSource.indexOf("value") + 2);
    },
  );

  it("reconstructs image source with the author URL instead of the preview URL", () => {
    const image = schema.nodes.image.create({
      src: "asset:///tmp/diagram.png",
      alt: "Diagram",
      title: "Architecture",
    });
    const paragraph = schema.nodes.paragraph.create(null, image);
    const doc = schema.nodes.doc.create(null, paragraph);
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
    });

    const target = findWysiwygMarkdownSourceTarget(
      state,
      serializeFixtureDocument,
      () => "assets/diagram.png",
    );

    expect(target).toMatchObject({
      kind: "image",
      layout: "image",
      source: '![Diagram](assets/diagram.png "Architecture")',
    });
  });

  it("prefers link source over surrounding text marks", () => {
    const marks = [
      schema.marks.strong.create(),
      schema.marks.link.create({ href: "https://example.com", title: null }),
    ];
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("nested", marks)),
    );
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });

    expect(findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument)?.kind).toBe("link");
  });

  it("treats a mark's right edge as outside while keeping its left edge addressable", () => {
    const { state, markedFrom, markedTo } = createMarkedState("link");
    const atLeftEdge = EditorState.create({
      doc: state.doc,
      selection: TextSelection.create(state.doc, markedFrom),
    });
    const afterRightEdge = EditorState.create({
      doc: state.doc,
      selection: TextSelection.create(state.doc, markedTo),
    });

    expect(findWysiwygMarkdownSourceTarget(atLeftEdge, serializeFixtureDocument)?.kind).toBe(
      "link",
    );
    expect(findWysiwygMarkdownSourceTarget(afterRightEdge, serializeFixtureDocument)).toBeNull();
  });
});

describe("WYSIWYG Markdown source sessions", () => {
  it("keeps reveal state non-dirty and maps a dirty draft through document changes", () => {
    const { state } = createMarkedState("link");
    const target = findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument);
    expect(target).not.toBeNull();
    if (!target) return;

    const revealed = createWysiwygMarkdownSourceSession(target);
    const editing = updateWysiwygMarkdownSourceDraft(revealed, "[value](next.md)", 8);
    const transaction = state.tr.insertText("prefix ", 1);
    const mapped = mapWysiwygMarkdownSourceSession(editing, transaction.mapping);

    expect(revealed.phase).toBe("revealed");
    expect(revealed.draft).toBe(target.source);
    expect(mapped?.phase).toBe("editing");
    expect(mapped?.draft).toBe("[value](next.md)");
    expect(mapped?.target.from).toBe(target.from + 7);
    expect(mapped?.target.to).toBe(target.to + 7);
  });

  it("blocks commit during composition and commits only after selection leaves", () => {
    const { state } = createMarkedState("inlineCode");
    const target = findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument);
    expect(target).not.toBeNull();
    if (!target) return;

    const editing = updateWysiwygMarkdownSourceDraft(
      createWysiwygMarkdownSourceSession(target),
      "`中文`",
      3,
    );
    const composing = setWysiwygMarkdownSourceComposition(editing, true);
    const outside = TextSelection.create(state.doc, 1);

    expect(shouldCommitWysiwygMarkdownSourceSession(composing, outside)).toBe(false);
    expect(canStartWysiwygMarkdownSourceEdit(composing)).toBe(false);
    expect(canStartWysiwygMarkdownSourceEdit(editing, true)).toBe(false);
    expect(canStartWysiwygMarkdownSourceEdit(editing)).toBe(true);
    expect(shouldCommitWysiwygMarkdownSourceSession(editing, state.selection)).toBe(false);
    expect(shouldCommitWysiwygMarkdownSourceSession(editing, outside)).toBe(true);
    expect(markWysiwygMarkdownSourceInvalid(editing).phase).toBe("invalid");
  });

  it("maps text offsets into the visible Markdown source", () => {
    expect(mapTextOffsetToSource("[label](target)", "label", 3)).toBe(4);
    expect(mapTextOffsetToSource("`code`", "code", 99)).toBe(6);
  });

  it("persists edits as raw nodes and keeps semantic commit out of history", () => {
    const rawSchema = createSourceTestSchema(true);
    const paragraph = rawSchema.nodes.paragraph.create(
      null,
      rawSchema.text("code", [rawSchema.marks.inlineCode.create()]),
    );
    const doc = rawSchema.nodes.doc.create(null, paragraph);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
    });
    const target = findWysiwygMarkdownSourceTarget(state, serializeFixtureDocument);
    expect(target).not.toBeNull();
    if (!target) return;

    const rawTransaction = replaceWysiwygMarkdownSourceTargetWithDraft(state.tr, target, "`code");
    expect(rawTransaction).not.toBeNull();
    if (!rawTransaction) return;
    const rawState = state.apply(rawTransaction);
    const rawNode = rawState.doc.nodeAt(target.from);

    expect(rawTransaction.docChanged).toBe(true);
    expect(rawTransaction.getMeta("addToHistory")).toBeUndefined();
    expect(rawNode?.type.name).toBe("wysiwyg_source_inline");
    expect(rawNode?.attrs.source).toBe("`code");
    expect(rawState.selection).toBeInstanceOf(NodeSelection);

    const updateTransaction = updateWysiwygMarkdownSourceNodeDraft(
      rawState.tr,
      target.from,
      "`fixed`",
    );
    expect(updateTransaction).not.toBeNull();
    if (!updateTransaction) return;
    const updatedState = rawState.apply(updateTransaction);
    const replacement = resolveWysiwygMarkdownSourceReplacement("inlineCode", "`fixed`", () =>
      rawSchema.nodes.doc.create(
        null,
        rawSchema.nodes.paragraph.create(
          null,
          rawSchema.text("fixed", [rawSchema.marks.inlineCode.create()]),
        ),
      ),
    );
    expect(replacement).not.toBeNull();
    if (!replacement) return;

    const commitTransaction = replaceWysiwygMarkdownSourceNodeWithParsed(
      updatedState.tr,
      target.from,
      replacement,
    );
    expect(commitTransaction).not.toBeNull();
    expect(commitTransaction?.getMeta("addToHistory")).toBe(false);
    expect(commitTransaction?.getMeta("md-editor-source-session-commit")).toBe(true);
    expect(commitTransaction?.doc.textContent).toBe("fixed");
    expect(commitTransaction?.doc.nodeAt(target.from)?.type.name).toBe("text");
  });

  it("stores image preview load state outside undo history", () => {
    const rawSchema = createSourceTestSchema(true);
    const source = "![Diagram](assets/diagram.png)";
    const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
      kind: "image",
      source,
      originalSource: source,
      sourceCursorOffset: source.length,
    });
    const doc = rawSchema.nodes.doc.create(null, rawSchema.nodes.paragraph.create(null, rawNode));
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
    });

    const transaction = updateWysiwygMarkdownImagePreviewState(
      state.tr,
      1,
      source,
      "asset:///tmp/diagram.png",
      "loaded",
    );

    expect(transaction).not.toBeNull();
    expect(transaction?.getMeta("addToHistory")).toBe(false);
    expect(transaction?.getMeta("md-editor-source-image-preview")).toBe(true);
    const previewNode = transaction?.doc.nodeAt(1);
    expect(previewNode?.attrs.imagePreviewStatus).toBe("loaded");
    expect(isWysiwygMarkdownImagePreviewReady(previewNode!, source)).toBe(true);
    expect(isWysiwygMarkdownImagePreviewReady(previewNode!, `${source} `)).toBe(false);
  });
});

describe("WYSIWYG invalid source preview round trips", () => {
  it.each([
    ["heading", "block", "####### invalid", "idle"],
    ["strong", "inline", "**bold", "idle"],
    ["emphasis", "inline", "*italic", "idle"],
    ["strikethrough", "inline", "~~strike", "idle"],
    ["link", "inline", "[label](", "idle"],
    ["image", "image", "![alt](missing.png)", "failed"],
    ["inlineCode", "inline", "`code", "idle"],
  ] as const)(
    "restores invalid %s source from an exact sidecar without persisting metadata",
    (kind, layout, source, imagePreviewStatus) => {
      const draft: WysiwygMarkdownSourceDraft = {
        id: `draft-${kind}`,
        kind,
        layout,
        source,
        from: 0,
        to: source.length,
        imagePreviewStatus,
      };
      const previewMarkdown = prepareWysiwygMarkdownSourceDraftsForPreview(source, [draft]);
      const marker = previewMarkdown.match(/<md-editor-wysiwyg-source[^>]+\/>/u)?.[0] ?? "";

      const tree: Root = {
        type: "root",
        children: [{ type: "html", value: marker }],
      };
      restoreWysiwygMarkdownSourceDraftsInTree(tree, [draft]);
      expect(tree.children[0]).toMatchObject(
        layout === "block"
          ? { type: "wysiwyg_source_block", kind, source }
          : {
              type: "paragraph",
              children: [{ type: "wysiwyg_source_inline", kind, source }],
            },
      );

      const extracted = extractWysiwygMarkdownSourceDrafts(previewMarkdown, new Set([draft.id]));
      expect(extracted.markdown).toBe(source);
      expect(extracted.drafts).toEqual([draft]);
    },
  );

  it("leaves escaped, inline-code, fenced-code, and author HTML contexts untouched without sidecar provenance", () => {
    const markdown =
      '\\[]() and `[]()`\n\n```md\n![]()\n```\n\n<md-editor-wysiwyg-source data-id="author" />';
    expect(prepareWysiwygMarkdownSourceDraftsForPreview(markdown, [])).toBe(markdown);

    const tree: Root = {
      type: "root",
      children: [{ type: "html", value: '<md-editor-wysiwyg-source data-id="author" />' }],
    };
    restoreWysiwygMarkdownSourceDraftsInTree(tree, []);
    expect(tree.children[0]).toMatchObject({ type: "html" });
  });

  it("does not resurrect a sidecar draft after source-mode reconciliation removes it", () => {
    const source = "[label](";
    const draft: WysiwygMarkdownSourceDraft = {
      id: "removed-draft",
      kind: "link",
      layout: "inline",
      source,
      from: 0,
      to: source.length,
      imagePreviewStatus: "idle",
    };

    const removedDrafts = reconcileWysiwygMarkdownSourceDrafts("plain text", [draft]);
    expect(removedDrafts).toEqual([]);
    expect(reconcileWysiwygMarkdownSourceDrafts(source, removedDrafts)).toEqual([]);
  });

  it("extracts temporary markers only when their draft id exists in the current document", () => {
    const rawSchema = createSourceTestSchema(true);
    const source = "**bold";
    const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
      draftId: "trusted-draft",
      kind: "strong",
      source,
      originalSource: "**bold**",
      sourceCursorOffset: source.length,
    });
    const doc = rawSchema.nodes.doc.create(null, rawSchema.nodes.paragraph.create(null, rawNode));
    const draft: WysiwygMarkdownSourceDraft = {
      id: "trusted-draft",
      kind: "strong",
      layout: "inline",
      source,
      from: 0,
      to: source.length,
      imagePreviewStatus: "idle",
    };
    const serialized = prepareWysiwygMarkdownSourceDraftsForPreview(source, [draft]);

    expect(
      extractWysiwygMarkdownSourceDrafts(serialized, collectWysiwygMarkdownSourceDraftIds(doc))
        .markdown,
    ).toBe(source);
    expect(extractWysiwygMarkdownSourceDrafts(serialized, new Set()).markdown).toBe(serialized);
  });
});

describe("WYSIWYG Markdown source commit validation", () => {
  it.each([
    ["heading", createParsedHeading()],
    ["strong", createParsedMark("strong")],
    ["emphasis", createParsedMark("emphasis")],
    ["strikethrough", createParsedMark("strike_through")],
    ["link", createParsedMark("link", { href: "next.md", title: null })],
    ["image", createParsedImage("assets/next.png")],
    ["inlineCode", createParsedMark("inlineCode")],
  ] satisfies readonly [WysiwygMarkdownSourceKind, ProseMirrorNode][])(
    "accepts a parsed %s replacement",
    (kind, parsed) => {
      expect(resolveWysiwygMarkdownSourceReplacement(kind, "source", () => parsed)).not.toBeNull();
    },
  );

  it.each([
    ["heading", "####### invalid"],
    ["link", "[]()"],
    ["image", "![]()"],
    ["inlineCode", "`code"],
  ] satisfies readonly [WysiwygMarkdownSourceKind, string][])(
    "retains invalid %s source instead of committing plain text",
    (kind, source) => {
      const plain = schema.nodes.doc.create(
        null,
        schema.nodes.paragraph.create(null, schema.text(source)),
      );

      expect(resolveWysiwygMarkdownSourceReplacement(kind, source, () => plain)).toBeNull();
    },
  );

  it("rejects an empty image source even when the parser creates an image node", () => {
    expect(
      resolveWysiwygMarkdownSourceReplacement("image", "![]()", () => createParsedImage("")),
    ).toBeNull();
  });

  it("does not commit a partial link produced by URL auto-linking", () => {
    const link = schema.marks.link.create({ href: "https://example.com", title: null });
    const partialLink = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("[Docs]("),
        schema.text("https://example.com", [link]),
      ]),
    );

    expect(
      resolveWysiwygMarkdownSourceReplacement(
        "link",
        "[Docs](https://example.com",
        () => partialLink,
      ),
    ).toBeNull();
  });

  it("resolves valid image source for preview and silently rejects resolver failures", () => {
    const source = "![Diagram](assets/diagram.png)";
    const parse = () => createParsedImage("assets/diagram.png");

    expect(
      resolveWysiwygMarkdownImagePreview(
        source,
        parse,
        (authorSrc) => `asset:///workspace/${authorSrc}`,
      ),
    ).toEqual({
      authorSrc: "assets/diagram.png",
      previewSrc: "asset:///workspace/assets/diagram.png",
      alt: "image",
    });
    expect(
      resolveWysiwygMarkdownImagePreview(source, parse, () => {
        throw new Error("missing image");
      }),
    ).toBeNull();
    expect(resolveWysiwygMarkdownImagePreview("![]()", () => null)).toBeNull();
  });
});

describe("WYSIWYG Markdown source ProseMirror plugin", () => {
  it("reveals from selection without changing the document or history", () => {
    const { state: fixture } = createMarkedState("strong");
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () => null,
    });
    const state = EditorState.create({
      doc: fixture.doc,
      selection: fixture.selection,
      plugins: [plugin],
    });

    expect(wysiwygMarkdownSourcePluginKey.getState(state)?.session?.target.kind).toBe("strong");

    const transaction = state.tr.setSelection(TextSelection.create(state.doc, 1));
    const nextState = state.apply(transaction);

    expect(transaction.docChanged).toBe(false);
    expect(transaction.getMeta("addToHistory")).toBeUndefined();
    expect(nextState.doc.eq(state.doc)).toBe(true);
    expect(wysiwygMarkdownSourcePluginKey.getState(nextState)?.session).toBeNull();
  });

  it("does not freeze a pre-ready serializer stub when serialize is resolved lazily", () => {
    // Mirrors Milkdown's serializerCtx default (outOfScope) that is replaced only after
    // SerializerReady. Capturing the stub at $prose factory time would white-screen headings.
    let serializerReady = false;
    const heading = schema.nodes.heading.create({ level: 1 }, schema.text("Title"));
    const doc = schema.nodes.doc.create(null, heading);
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: (node) => {
        if (!serializerReady) {
          throw new Error("Should not call a context out of the plugin.");
        }
        return serializeFixtureDocument(node);
      },
      parse: () => null,
    });

    serializerReady = true;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
      plugins: [plugin],
    });

    expect(wysiwygMarkdownSourcePluginKey.getState(state)?.session?.target).toMatchObject({
      kind: "heading",
      source: "# Title",
    });
  });

  it("reveals image source above the existing preview without hiding the image node", () => {
    const image = schema.nodes.image.create({
      src: "asset:///tmp/diagram.png",
      alt: "Diagram",
      title: "Architecture",
    });
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, image));
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () => null,
      includeImages: true,
      getAuthorImageSrc: () => "assets/diagram.png",
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
      plugins: [plugin],
    });
    const pluginState = wysiwygMarkdownSourcePluginKey.getState(state);

    expect(pluginState?.session?.target).toMatchObject({
      kind: "image",
      layout: "image",
      source: '![Diagram](assets/diagram.png "Architecture")',
    });
    expect(pluginState?.decorations.find()).toHaveLength(1);
    expect(state.doc.nodeAt(1)?.type.name).toBe("image");
  });

  it("ignores a stale image completion after a newer preview request starts", () => {
    const requests = createWysiwygImagePreviewRequestGate();
    const first = requests.begin();
    const second = requests.begin();

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
    requests.invalidate();
    expect(requests.isCurrent(second)).toBe(false);
  });

  it.each([
    ["link", "link", "[](", "[]()"],
    ["image with an empty source", "image", "![](", "![]()"],
    ["image with a valid source", "image", "![alt](asset.png", "![alt](asset.png)"],
  ] satisfies readonly [string, WysiwygMarkdownSourceKind, string, string][])(
    "replaces a typed %s with the matching durable raw source node",
    (_, expectedKind, sourceBeforeInput, expectedSource) => {
      const rawSchema = createSourceTestSchema(true);
      const doc = rawSchema.nodes.doc.create(
        null,
        rawSchema.nodes.paragraph.create(null, rawSchema.text(sourceBeforeInput)),
      );
      const state = EditorState.create({
        doc,
        selection: TextSelection.create(doc, sourceBeforeInput.length + 1),
      });
      const plugin = createWysiwygMarkdownSourceProsePlugin({
        serialize: serializeFixtureDocument,
        parse: () => null,
      });
      let dispatched = state.tr;
      const view = {
        state,
        composing: false,
        dispatch(transaction) {
          dispatched = transaction;
        },
      } as EditorView;

      const inputPosition = sourceBeforeInput.length + 1;
      expect(
        plugin.props.handleTextInput?.call(
          plugin,
          view,
          inputPosition,
          inputPosition,
          ")",
          () => state.tr,
        ),
      ).toBe(true);
      expect(dispatched.doc.nodeAt(1)?.type.name).toBe("wysiwyg_source_inline");
      expect(dispatched.doc.nodeAt(1)?.attrs.kind).toBe(expectedKind);
      expect(dispatched.doc.nodeAt(1)?.attrs.source).toBe(expectedSource);
      expect(dispatched.selection).toBeInstanceOf(NodeSelection);
    },
  );

  it.each([
    ["inline code", createInlineCodeInputState()],
    ["fenced code", createCodeBlockInputState()],
  ])("does not capture typed []() inside %s", (_, state) => {
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () => null,
    });
    let dispatched = false;
    const view = {
      state,
      composing: false,
      dispatch() {
        dispatched = true;
      },
    } as unknown as EditorView;

    expect(plugin.props.handleTextInput?.call(plugin, view, 4, 4, ")", () => state.tr)).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("commits a valid raw link after selection leaves using a no-history append", () => {
    const rawSchema = createSourceTestSchema(true);
    const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
      kind: "link",
      source: "[label](next.md)",
      originalSource: "[]()",
      sourceCursorOffset: 16,
    });
    const doc = rawSchema.nodes.doc.create(
      null,
      rawSchema.nodes.paragraph.create(null, [rawNode, rawSchema.text(" after")]),
    );
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () =>
        rawSchema.nodes.doc.create(
          null,
          rawSchema.nodes.paragraph.create(
            null,
            rawSchema.text("label", [
              rawSchema.marks.link.create({ href: "next.md", title: null }),
            ]),
          ),
        ),
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
      plugins: [plugin],
    });

    const result = state.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[1].getMeta("addToHistory")).toBe(false);
    expect(result.state.doc.textContent).toBe("label after");
    expect(result.state.doc.nodeAt(1)?.marks[0]?.type.name).toBe("link");
  });

  it("commits an edited image only after its current preview loads", () => {
    const rawSchema = createSourceTestSchema(true);
    const source = "![Diagram](assets/next.png)";
    const previewSrc = "asset:///workspace/assets/next.png";
    const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
      kind: "image",
      source,
      originalSource: "![Diagram](assets/old.png)",
      sourceCursorOffset: source.length,
      imagePreviewSource: source,
      imagePreviewSrc: previewSrc,
      imagePreviewStatus: "loaded",
    });
    const doc = rawSchema.nodes.doc.create(
      null,
      rawSchema.nodes.paragraph.create(null, [rawNode, rawSchema.text(" after")]),
    );
    const registeredSources: Array<readonly [string, string]> = [];
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () =>
        rawSchema.nodes.doc.create(
          null,
          rawSchema.nodes.paragraph.create(
            null,
            rawSchema.nodes.image.create({
              src: "assets/next.png",
              alt: "Diagram",
              title: "",
            }),
          ),
        ),
      registerImageSource: (preview, author) => {
        registeredSources.push([preview, author]);
      },
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
      plugins: [plugin],
    });

    const result = state.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 3)),
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.state.doc.nodeAt(1)?.type.name).toBe("image");
    expect(result.state.doc.nodeAt(1)?.attrs.src).toBe(previewSrc);
    expect(registeredSources).toEqual([[previewSrc, "assets/next.png"]]);
  });

  it.each(["idle", "loading", "failed"])(
    "keeps valid image source editable while preview status is %s",
    (imagePreviewStatus) => {
      const rawSchema = createSourceTestSchema(true);
      const source = "![Diagram](assets/missing.png)";
      const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
        kind: "image",
        source,
        originalSource: source,
        sourceCursorOffset: source.length,
        imagePreviewSource: source,
        imagePreviewSrc: "asset:///workspace/assets/missing.png",
        imagePreviewStatus,
      });
      const doc = rawSchema.nodes.doc.create(
        null,
        rawSchema.nodes.paragraph.create(null, [rawNode, rawSchema.text(" after")]),
      );
      const plugin = createWysiwygMarkdownSourceProsePlugin({
        serialize: serializeFixtureDocument,
        parse: () =>
          rawSchema.nodes.doc.create(
            null,
            rawSchema.nodes.paragraph.create(
              null,
              rawSchema.nodes.image.create({
                src: "assets/missing.png",
                alt: "Diagram",
                title: "",
              }),
            ),
          ),
      });
      const state = EditorState.create({
        doc,
        selection: NodeSelection.create(doc, 1),
        plugins: [plugin],
      });

      const result = state.applyTransaction(
        state.tr.setSelection(TextSelection.create(state.doc, 3)),
      );

      expect(result.transactions).toHaveLength(1);
      expect(result.state.doc.nodeAt(1)?.type.name).toBe("wysiwyg_source_inline");
      expect(result.state.doc.nodeAt(1)?.attrs.source).toBe(source);
    },
  );

  it("keeps invalid raw source in the document after selection leaves", () => {
    const rawSchema = createSourceTestSchema(true);
    const rawNode = rawSchema.nodes.wysiwyg_source_inline.create({
      kind: "link",
      source: "[]()",
      originalSource: "[]()",
      sourceCursorOffset: 4,
    });
    const doc = rawSchema.nodes.doc.create(
      null,
      rawSchema.nodes.paragraph.create(null, [rawNode, rawSchema.text(" after")]),
    );
    const plugin = createWysiwygMarkdownSourceProsePlugin({
      serialize: serializeFixtureDocument,
      parse: () =>
        rawSchema.nodes.doc.create(
          null,
          rawSchema.nodes.paragraph.create(null, rawSchema.text("[]()")),
        ),
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 1),
      plugins: [plugin],
    });

    const result = state.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 3)),
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.state.doc.nodeAt(1)?.type.name).toBe("wysiwyg_source_inline");
    expect(result.state.doc.nodeAt(1)?.attrs.source).toBe("[]()");
  });
});

function createMarkedState(kind: WysiwygMarkdownSourceKind) {
  const mark = createMark(kind);
  const before = schema.text("before ");
  const marked = schema.text("value", [mark]);
  const paragraph = schema.nodes.paragraph.create(null, [before, marked, schema.text(" after")]);
  const doc = schema.nodes.doc.create(null, paragraph);
  const markedFrom = 1 + before.nodeSize;
  const markedTo = markedFrom + marked.nodeSize;
  return {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, markedFrom + 2),
    }),
    markedFrom,
    markedTo,
  };
}

function createMark(kind: WysiwygMarkdownSourceKind) {
  switch (kind) {
    case "strong":
      return schema.marks.strong.create({ marker: "*" });
    case "emphasis":
      return schema.marks.emphasis.create({ marker: "*" });
    case "strikethrough":
      return schema.marks.strike_through.create();
    case "link":
      return schema.marks.link.create({ href: "docs/readme.md", title: "Docs" });
    case "inlineCode":
      return schema.marks.inlineCode.create();
    default:
      throw new Error(`Unsupported mark fixture: ${kind}`);
  }
}

function serializeFixtureDocument(doc: ProseMirrorNode): string {
  const block = doc.firstChild;
  if (!block) return "";
  if (block.type.name === "heading") {
    return `${"#".repeat(Number(block.attrs.level))} ${serializeInline(block)}\n`;
  }
  return `${serializeInline(block)}\n`;
}

function serializeInline(block: ProseMirrorNode): string {
  let result = "";
  block.forEach((node) => {
    if (node.type.name === "image") {
      const title = node.attrs.title ? ` "${String(node.attrs.title)}"` : "";
      result += `![${String(node.attrs.alt)}](${String(node.attrs.src)}${title})`;
      return;
    }

    let text = node.textContent;
    for (let index = node.marks.length - 1; index >= 0; index -= 1) {
      const mark = node.marks[index];
      if (!mark) continue;
      switch (mark.type.name) {
        case "strong":
          text = `**${text}**`;
          break;
        case "emphasis":
          text = `*${text}*`;
          break;
        case "strike_through":
          text = `~~${text}~~`;
          break;
        case "link": {
          const title = mark.attrs.title ? ` "${String(mark.attrs.title)}"` : "";
          text = `[${text}](${String(mark.attrs.href)}${title})`;
          break;
        }
        case "inlineCode":
          text = `\`${text}\``;
          break;
      }
    }
    result += text;
  });
  return result;
}

function createParsedHeading() {
  return schema.nodes.doc.create(
    null,
    schema.nodes.heading.create({ level: 3 }, schema.text("Heading")),
  );
}

function createParsedMark(markName: string, attrs?: Record<string, unknown>) {
  return schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create(
      null,
      schema.text("value", [schema.marks[markName].create(attrs)]),
    ),
  );
}

function createParsedImage(src: string) {
  return schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src, alt: "image", title: "" }),
    ),
  );
}

function createSourceTestSchema(includeRawSource = false) {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      marks: "",
    },
    text: { group: "inline" },
    image: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: true,
      attrs: {
        src: { default: "" },
        alt: { default: "" },
        title: { default: "" },
      },
    },
  };
  if (includeRawSource) {
    const sourceNodeAttrs = {
      draftId: { default: "" },
      kind: { default: "link" },
      source: { default: "" },
      originalSource: { default: "" },
      sourceCursorOffset: { default: 0 },
      imagePreviewSource: { default: "" },
      imagePreviewSrc: { default: "" },
      imagePreviewStatus: { default: "idle" },
    };
    nodes.wysiwyg_source_inline = {
      inline: true,
      group: "inline",
      atom: true,
      isolating: true,
      selectable: true,
      attrs: sourceNodeAttrs,
    };
    nodes.wysiwyg_source_block = {
      group: "block",
      atom: true,
      isolating: true,
      selectable: true,
      attrs: { ...sourceNodeAttrs, kind: { default: "heading" } },
    };
  }

  return new Schema({
    nodes,
    marks: {
      strong: { attrs: { marker: { default: "*" } } },
      emphasis: { attrs: { marker: { default: "*" } } },
      strike_through: {},
      link: {
        attrs: {
          href: {},
          title: { default: null },
        },
      },
      inlineCode: { code: true },
    },
  });
}

function createInlineCodeInputState(): EditorState {
  const rawSchema = createSourceTestSchema(true);
  const doc = rawSchema.nodes.doc.create(
    null,
    rawSchema.nodes.paragraph.create(
      null,
      rawSchema.text("[](", [rawSchema.marks.inlineCode.create()]),
    ),
  );
  return EditorState.create({ doc, selection: TextSelection.create(doc, 4) });
}

function createCodeBlockInputState(): EditorState {
  const rawSchema = createSourceTestSchema(true);
  const doc = rawSchema.nodes.doc.create(
    null,
    rawSchema.nodes.code_block.create(null, rawSchema.text("[](")),
  );
  return EditorState.create({ doc, selection: TextSelection.create(doc, 4) });
}
