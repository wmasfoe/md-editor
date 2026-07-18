import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const documentActionsSource = readFileSync(
  new URL("../src/app/controller/useDocumentActionsController.ts", import.meta.url),
  "utf8",
);
const desktopControllerSource = readFileSync(
  new URL("../src/app/controller/useDesktopEditorController.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../src/app/runtime/editor-runtime.ts", import.meta.url),
  "utf8",
);
const windowGuardsSource = readFileSync(
  new URL("../src/app/events/window-guards.ts", import.meta.url),
  "utf8",
);
const settingsPageSource = readFileSync(
  new URL("../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const documentStoreSource = readFileSync(
  new URL("../src/app/document-store.ts", import.meta.url),
  "utf8",
);
const documentUiStoreSource = readFileSync(
  new URL("../src/app/stores/document-ui-store.ts", import.meta.url),
  "utf8",
);

describe("desktop document controller boundaries", () => {
  it("routes open, recent, tree, folder, and linked Markdown through document replacement", () => {
    expect(documentActionsSource).toMatch(
      /const document = await fileService\.openDocument\(\);[\s\S]{0,160}replaceDocument\(document\)/u,
    );
    expect(documentActionsSource).toMatch(
      /const document = await fileService\.openDocumentAtPath\(filePath\);[\s\S]{0,160}replaceDocument\(document\)/u,
    );
    expect(documentActionsSource).toMatch(
      /const firstDocument = firstMarkdownPath[\s\S]{0,280}replaceDocument\(firstDocument\)[\s\S]{0,80}startBlankDocument\(\)/u,
    );
    expect(desktopControllerSource).toMatch(
      /const document = await fileService\.openDocumentAtPath\(linked\.path\);[\s\S]{0,160}replaceDocument\(document\)/u,
    );
    expect(documentActionsSource).toMatch(
      /if \(!document\) \{\s*return;\s*\}[\s\S]{0,120}runtime\.document\.replaceDocument/u,
    );
  });

  it("keeps same-document programmatic edits renderer-first and removes revision side channels", () => {
    const externalEditBlock = documentActionsSource.slice(
      documentActionsSource.indexOf("const applyProgrammaticMarkdown"),
      documentActionsSource.indexOf("const switchMode"),
    );
    expect(externalEditBlock).toContain("access.ports.applyExternalEdit({");
    expect(externalEditBlock).not.toContain("replaceDocument(");
    expect(externalEditBlock).not.toContain("updateMarkdown(");

    const controllerGraph = `${documentActionsSource}\n${desktopControllerSource}`;
    for (const retiredSideChannel of [
      "setEditorRevision",
      "editorRevision",
      "documentRevision",
      "markSaved(",
      "updateSavedBaseline(",
      "runtime.document.setMode(",
    ]) {
      expect(controllerGraph).not.toContain(retiredSideChannel);
    }
  });

  it("does not activate deferred formatting or image paste/drop features", () => {
    expect(runtimeSource).not.toContain("createMarkdownFormatFeature");
    expect(desktopControllerSource).not.toContain("bindPasteImageListener");
    expect(desktopControllerSource).not.toContain("bindDropImageListener");
  });

  it("routes close and update relaunch paths through persistence-aware discard protection", () => {
    expect(windowGuardsSource.match(/isDiscardProtectionRequired\(/gu)).toHaveLength(2);
    expect(desktopControllerSource).toContain("if (!isDiscardProtectionRequired(current))");
    expect(settingsPageSource).not.toContain("relaunchUpdate");
    expect(settingsPageSource).toContain("onRelaunchAfterUpdate={onRelaunchAfterUpdate}");
  });

  it("does not expose snapshot-only document mutation helpers from production stores", () => {
    const storeGraph = `${documentStoreSource}\n${documentUiStoreSource}`;
    for (const retiredMutation of [
      "updateDocumentMarkdown",
      "markDocumentSaved",
      "updateDocumentSavedBaseline",
      "setDocumentMode",
      "commitMarkdown",
      "runtime.document.updateMarkdown(",
      "runtime.document.markSaved(",
      "runtime.document.updateSavedBaseline(",
      "runtime.document.setMode(",
    ]) {
      expect(storeGraph).not.toContain(retiredMutation);
    }
  });
});
