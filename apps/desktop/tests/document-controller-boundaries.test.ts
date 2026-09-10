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
const desktopEditorSource = readFileSync(
  new URL("../src/components/DesktopCodeMirrorEditor.tsx", import.meta.url),
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

  it("invokes flushPendingEdits before mode switch, document save, and command dispatch", () => {
    // switchMode must flush pending edits inside try block
    expect(documentActionsSource).toMatch(
      /const switchMode = useCallback\([\s\S]{0,400}access\.ports\.flushPendingEdits\?\.[\s\S]{0,100}switchEditorModeSafely/u,
    );

    // saveDocument must flush pending edits before executing save
    expect(documentActionsSource).toMatch(
      /const saveDocument = useCallback\([\s\S]{0,500}access\.ports\.flushPendingEdits\?\.[\s\S]{0,300}executeDocumentSave/u,
    );

    // dispatchCommand must flush pending edits before dispatching runtime commands
    expect(desktopControllerSource).toMatch(
      /const dispatchCommand = useCallback\([\s\S]{0,250}access\.ports\.flushPendingEdits\?\.[\s\S]{0,120}runtime\.commands\.dispatch/u,
    );
  });

  it("guards mode switch against concurrent re-entrancy and aborts in-flight AI continuation", () => {
    const switchModeSlice = documentActionsSource.slice(
      documentActionsSource.indexOf("const switchMode = useCallback"),
      documentActionsSource.indexOf("const replaceDocument = useCallback"),
    );

    // Re-entrancy guard
    expect(switchModeSlice).toContain("if (isSwitchingModeRef.current)");
    expect(switchModeSlice).toContain("isSwitchingModeRef.current = true;");
    expect(switchModeSlice).toContain("isSwitchingModeRef.current = false;");

    // Active AI continuation abort on mode transition
    expect(desktopEditorSource).toMatch(
      /if \(event\.transition\.kind === "mode"\) \{[\s\S]{0,300}abortControllerRef\.current\.abort\(\);/u,
    );
  });
});
