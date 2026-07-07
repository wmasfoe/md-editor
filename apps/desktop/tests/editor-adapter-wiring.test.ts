import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopMilkdownEditorSource = readFileSync(
  new URL("../src/components/DesktopMilkdownEditor.tsx", import.meta.url),
  "utf8"
);
const desktopSourceEditorSource = readFileSync(
  new URL("../src/components/DesktopSourceEditor.tsx", import.meta.url),
  "utf8"
);
const editorUiMilkdownSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/MilkdownEditor.tsx", import.meta.url),
  "utf8"
);

describe("desktop editor adapter wiring", () => {
  it("keeps Milkdown controller composition in editor-ui and desktop as an adapter bridge", () => {
    expect(editorUiMilkdownSource).toContain("useMdxAiController<TPlugin>(mdxAi)");
    expect(editorUiMilkdownSource).toContain("renderMdxComponentMenu");
    expect(editorUiMilkdownSource).toContain("onEditorCommandsChange");

    expect(desktopMilkdownEditorSource).not.toContain("useMdxAiController");
    expect(desktopMilkdownEditorSource).not.toContain("useMdxAiStore");
    expect(desktopMilkdownEditorSource).not.toContain("clearMdxInsertRequest");
    expect(desktopMilkdownEditorSource).toContain("mdxAi={{");
    expect(desktopMilkdownEditorSource).toContain("getMdxComponentPlugins");
    expect(desktopMilkdownEditorSource).toContain("getAiCompletionReadiness");
    expect(desktopMilkdownEditorSource).toContain("requestAiCompletion: requestDesktopAiContinuation");
    expect(desktopMilkdownEditorSource).toContain("onEditorCommandsChange={registerEditorCommands}");
    expect(desktopMilkdownEditorSource).toContain("renderMdxComponentMenu={renderMdxComponentMenu}");
    expect(desktopMilkdownEditorSource).toContain("resolveImageSrc={resolveImageSrc}");
    expect(desktopMilkdownEditorSource).toContain("settings.editor.wysiwygFontSize");
  });

  it("remounts Milkdown on document replacement to honor primitive mount-scoped state", () => {
    expect(editorUiMilkdownSource).toContain("Milkdown owns document state after mount");
    expect(editorUiMilkdownSource).toContain("for document replacement");
    expect(desktopMilkdownEditorSource).toContain("key={documentKey}");
  });

  it("keeps source mode as a thin document and scroll adapter", () => {
    expect(desktopSourceEditorSource).toContain("useDocumentSnapshot()");
    expect(desktopSourceEditorSource).toContain("useDocumentUiStore()");
    expect(desktopSourceEditorSource).toContain('modeScrollTarget?.mode === "source"');
    expect(desktopSourceEditorSource).toContain("onScrollRatioChange={updateModeScrollRatio}");
    expect(desktopSourceEditorSource).toContain("onScrollTargetApplied={completeModeScrollTarget}");
    expect(desktopSourceEditorSource).not.toContain("useMdxAiController");
    expect(desktopSourceEditorSource).not.toContain("requestDesktopAiContinuation");
  });
});
