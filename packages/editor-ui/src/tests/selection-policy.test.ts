import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorStyles = readFileSync(
  new URL("../components/MilkdownEditor.css", import.meta.url),
  "utf8"
);
const imageSelectionSource = readFileSync(
  new URL("../utils/image-selection.ts", import.meta.url),
  "utf8"
);
const milkdownEditorSource = readFileSync(
  new URL("../components/MilkdownEditor.tsx", import.meta.url),
  "utf8"
);
const imeCompositionGuardSource = readFileSync(
  new URL("../utils/ime-composition-guard.ts", import.meta.url),
  "utf8"
);
const aiSuggestionSource = readFileSync(
  new URL("../utils/ai-suggestion.ts", import.meta.url),
  "utf8"
);
describe("editor selection policy", () => {
  it("never disables native selection on the whole ProseMirror surface", () => {
    expect(editorStyles).not.toContain(".ProseMirror.md-editor-image-node-selected");
  });

  it("keeps native drag and selection disabled on image elements", () => {
    const imageRule = editorStyles.match(
      /\.milkdown \.ProseMirror img:not\(\.ProseMirror-separator\) \{(?<body>[^}]+)\}/u
    );

    expect(imageRule?.groups?.body).toContain("-webkit-user-drag: none");
    expect(imageRule?.groups?.body).toContain("-webkit-user-select: none");
    expect(imageRule?.groups?.body).toContain("user-select: none");
  });

  it("does not treat ProseMirror separator images as editor image nodes", () => {
    expect(editorStyles).not.toContain(".milkdown .ProseMirror img {");
    expect(editorStyles).toContain("img:not(.ProseMirror-separator)");
    expect(imageSelectionSource).toContain("img:not(.ProseMirror-separator)");
    expect(imageSelectionSource).toContain("clearEditorImageDomState");
    expect(imageSelectionSource).toContain('removeAttribute("data-md-editor-image")');
  });

  it("uses a transient image guard that yields before new user selection input", () => {
    expect(imageSelectionSource).toContain("mousedown(view, event)");
    expect(imageSelectionSource).toContain('addEventListener("selectionchange"');
    expect(imageSelectionSource).toContain('addEventListener("mousedown"');
    expect(imageSelectionSource).toContain('addEventListener("keydown"');
    expect(imageSelectionSource).not.toContain("scheduleNativeSelectionCleanup");
    expect(imageSelectionSource).not.toContain("md-editor-image-node-selected");
  });

  it("shows pointer cursor on links only while the link-opening modifier is active", () => {
    expect(milkdownEditorSource).toContain("milkdown-host--link-modifier-active");
    expect(editorStyles).toContain(".milkdown-host--link-modifier-active .milkdown .ProseMirror a[href]");
    expect(editorStyles).toContain("cursor: pointer");
  });

  it("renders AI edit replacement as a scoped mirror preview layer", () => {
    expect(aiSuggestionSource).toContain("createAiEditPreviewAnchor(view, edit)");
    expect(aiSuggestionSource).toContain("createAiEditPreviewModel");
    expect(aiSuggestionSource).toContain("isAiEditPreviewGeometryReady");
    expect(aiSuggestionSource).toContain("isAiEditPreviewAnchorPointReady(anchorRect)");
    expect(aiSuggestionSource).not.toContain("isAiEditPreviewGeometryReady(anchorRect)");
    const editOriginalRule = editorStyles.match(/\.md-ai-edit-original \{(?<body>[^}]+)\}/u);
    const editAnchorRule = editorStyles.match(/\.md-ai-edit-preview-anchor \{(?<body>[^}]+)\}/u);
    const editMirrorRule = editorStyles.match(/\.md-ai-edit-preview-mirror \{(?<body>[^}]+)\}/u);
    const editReplacementRule = editorStyles.match(/\.md-ai-edit-preview-replacement \{(?<body>[^}]+)\}/u);
    const editPlaceholderRule = editorStyles.match(/\.md-ai-edit-preview-placeholder \{(?<body>[^}]+)\}/u);
    expect(editOriginalRule?.groups?.body).toContain("text-decoration: line-through;");
    expect(editOriginalRule?.groups?.body).not.toContain("display: none;");
    expect(editAnchorRule?.groups?.body).toContain("position: relative;");
    expect(editAnchorRule?.groups?.body).toContain("width: 0;");
    expect(editAnchorRule?.groups?.body).toContain("height: 0;");
    expect(editMirrorRule?.groups?.body).toContain("position: absolute;");
    expect(editMirrorRule?.groups?.body).toContain("white-space: pre-wrap;");
    expect(editMirrorRule?.groups?.body).toContain("overflow-wrap: anywhere;");
    expect(editMirrorRule?.groups?.body).toContain("pointer-events: none;");
    expect(editMirrorRule?.groups?.body).toContain("user-select: none;");
    expect(editReplacementRule?.groups?.body).toContain("background: color-mix");
    expect(editReplacementRule?.groups?.body).toContain("color: color-mix");
    expect(editPlaceholderRule?.groups?.body).toContain("color: transparent;");
    expect(editorStyles).not.toContain(".md-ai-edit-replacement");
    expect(aiSuggestionSource).not.toContain('createAiInlineSuggestionNode("md-ai-edit-replacement"');
    expect(editorStyles).not.toContain("--md-ai-edit-preview-width");
    expect(aiSuggestionSource).not.toContain("--md-ai-edit-preview-width");
    expect(aiSuggestionSource).not.toContain("setAiEditPreviewWidth");
    expect(aiSuggestionSource).not.toContain("measureAiEditPreviewBlocks");
  });

  it("keeps AI continuation ghost text on the non-document side of the real cursor", () => {
    const continuationWidget = aiSuggestionSource.match(
      /createAiInlineSuggestionNode\("md-ai-suggestion", ` \$\{displayContinuation\}`\)[\s\S]+?\{\n\s+side: 1,\n\s+ignoreSelection: true/u
    );

    expect(continuationWidget).not.toBeNull();
    expect(aiSuggestionSource).toContain(".setSelection(selection)");
    expect(aiSuggestionSource).toContain("isSelectionAtSuggestionAnchor");
    const suggestionRule = editorStyles.match(/\.md-ai-suggestion \{(?<body>[^}]+)\}/u);
    expect(suggestionRule?.groups?.body).toContain("display: inline;");
    expect(suggestionRule?.groups?.body).toContain("white-space: pre-wrap;");
    expect(suggestionRule?.groups?.body).toContain("overflow-wrap: anywhere;");
    expect(suggestionRule?.groups?.body).not.toContain("position: absolute;");
    expect(editorStyles).not.toContain(".md-ai-suggestion-anchor");
  });

  it("pauses AI suggestions while an IME composition is active", () => {
    expect(milkdownEditorSource).toContain('addEventListener("compositionstart"');
    expect(milkdownEditorSource).toContain("milkdown-host--ime-composing");
    expect(milkdownEditorSource).toContain("clearAiSuggestion(view)");
    expect(milkdownEditorSource).toContain("isImeComposingRef.current || view.composing");
  });

  it("does not rewrite editor content while an IME composition is active", () => {
    expect(milkdownEditorSource).toContain("compositionMarkdownDirtyRef.current = true");
    expect(milkdownEditorSource).toContain("isImeComposingRef.current || view.composing");
    expect(milkdownEditorSource).toContain("return;");
    expect(milkdownEditorSource).toContain("serializer(view.state.doc)");
    expect(milkdownEditorSource).toContain("IME_MARKDOWN_PUBLISH_DELAY_MS = 260");
    expect(milkdownEditorSource).not.toContain("compositionMarkdownPendingRef");
    expect(editorStyles).not.toMatch(
      /^\.milkdown \.ProseMirror br\.ProseMirror-trailingBreak \{\n  display: none;/mu
    );
  });

  it("hides ProseMirror trailing breaks only during active IME composition", () => {
    expect(editorStyles).toContain(
      ".milkdown-host--ime-composing .milkdown .ProseMirror br.ProseMirror-trailingBreak"
    );
    expect(editorStyles).toContain("br.ProseMirror-trailingBreak {\n  display: none;");
    expect(editorStyles).toContain(
      ".milkdown-host--ime-composing .milkdown .ProseMirror p {\n  min-height: 1.6em;"
    );
  });

  it("guards against composition hardbreaks leaking into markdown", () => {
    expect(milkdownEditorSource).toContain("imeCompositionGuardPlugin");
    expect(imeCompositionGuardSource).toContain('node.type.name === "hardbreak"');
    expect(imeCompositionGuardSource).toContain('transaction.getMeta("composition")');
    expect(imeCompositionGuardSource).toContain("IME_COMPOSITION_SETTLE_DELAY_MS = 260");
  });
});
