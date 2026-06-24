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

describe("editor selection policy", () => {
  it("never disables native selection on the whole ProseMirror surface", () => {
    expect(editorStyles).not.toContain(".ProseMirror.md-editor-image-node-selected");
  });

  it("keeps native drag and selection disabled on image elements", () => {
    const imageRule = editorStyles.match(/\.milkdown \.ProseMirror img \{(?<body>[^}]+)\}/u);

    expect(imageRule?.groups?.body).toContain("-webkit-user-drag: none");
    expect(imageRule?.groups?.body).toContain("-webkit-user-select: none");
    expect(imageRule?.groups?.body).toContain("user-select: none");
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

  it("anchors AI edit ghost text at the start of the replaced range", () => {
    expect(readFileSync(
      new URL("../utils/ai-suggestion.ts", import.meta.url),
      "utf8"
    )).toContain("Decoration.widget(\n        edit.from,");
  });

  it("pauses AI suggestions while an IME composition is active", () => {
    expect(milkdownEditorSource).toContain('addEventListener("compositionstart"');
    expect(milkdownEditorSource).toContain("clearAiSuggestion(view)");
    expect(milkdownEditorSource).toContain("isImeComposingRef.current || view.composing");
  });

  it("guards against composition hardbreaks leaking into markdown", () => {
    expect(milkdownEditorSource).toContain("imeCompositionGuardPlugin");
    expect(imeCompositionGuardSource).toContain('node.type.name === "hardbreak"');
    expect(imeCompositionGuardSource).toContain('transaction.getMeta("composition")');
  });
});
