import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopMilkdownEditorSource = readFileSync(
  new URL("../src/components/DesktopMilkdownEditor.tsx", import.meta.url),
  "utf8",
);
const desktopSourceEditorSource = readFileSync(
  new URL("../src/components/DesktopSourceEditor.tsx", import.meta.url),
  "utf8",
);
const editorUiMilkdownSource = readFileSync(
  new URL(
    "../../../packages/editor-ui/src/components/MilkdownEditor/MilkdownEditor.tsx",
    import.meta.url,
  ),
  "utf8",
);
const editorUiMilkdownPrimitiveSource = readFileSync(
  new URL(
    "../../../packages/editor-ui/src/components/MilkdownEditor/MilkdownEditorPrimitive.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("desktop editor adapter wiring", () => {
  it("keeps Milkdown controller composition in editor-ui and desktop as an adapter bridge", () => {
    expect(editorUiMilkdownSource).toContain("useMdxAiController<TPlugin>(mdxAi)");
    expect(editorUiMilkdownSource).toContain("useEditorUiState()");
    expect(editorUiMilkdownSource).toContain("useEditorUiActions()");
    expect(editorUiMilkdownSource).toContain("renderMdxComponentMenu");
    expect(editorUiMilkdownSource).toContain("registerEditorCommands");

    expect(desktopMilkdownEditorSource).not.toContain("useMdxAiController");
    expect(desktopMilkdownEditorSource).not.toContain("useMdxAiStore");
    expect(desktopMilkdownEditorSource).not.toContain("clearMdxInsertRequest");
    expect(desktopMilkdownEditorSource).not.toContain("useEditorCommandsStore");
    expect(desktopMilkdownEditorSource).not.toContain("useEditorScrollStore");
    expect(desktopMilkdownEditorSource).not.toContain("useOutlineStore");
    expect(desktopMilkdownEditorSource).toContain("mdxAi={{");
    expect(desktopMilkdownEditorSource).toContain("getMdxComponentPlugins");
    expect(desktopMilkdownEditorSource).toContain("getAiCompletionReadiness");
    expect(desktopMilkdownEditorSource).toContain(
      "requestAiCompletion: requestDesktopAiContinuation",
    );
    expect(desktopMilkdownEditorSource).not.toContain("onEditorCommandsChange");
    expect(desktopMilkdownEditorSource).toContain(
      "renderMdxComponentMenu={renderMdxComponentMenu}",
    );
    expect(desktopMilkdownEditorSource).toContain("resolveImageSrc={resolveImageSrc}");
    expect(desktopMilkdownEditorSource).toContain("settings.editor.wysiwygFontSize");
  });

  it("remounts Milkdown on document replacement to honor primitive mount-scoped state", () => {
    expect(editorUiMilkdownPrimitiveSource).toContain("Milkdown owns document state after mount");
    expect(editorUiMilkdownPrimitiveSource).toContain("for document replacement");
    expect(editorUiMilkdownSource).toContain("<MilkdownProvider key={editorUiState.documentKey}>");
    expect(desktopMilkdownEditorSource).not.toContain("documentKey");
  });

  it("keeps source mode as a thin document adapter", () => {
    expect(desktopSourceEditorSource).toContain("useDocumentSnapshot()");
    expect(desktopSourceEditorSource).toContain("useDocumentUiStore()");
    expect(desktopSourceEditorSource).not.toContain("useEditorScrollStore");
    expect(desktopSourceEditorSource).not.toContain("useOutlineStore");
    expect(desktopSourceEditorSource).not.toContain('modeScrollTarget?.mode === "source"');
    expect(desktopSourceEditorSource).not.toContain("onScrollRatioChange={updateModeScrollRatio}");
    expect(desktopSourceEditorSource).not.toContain(
      "onScrollTargetApplied={completeModeScrollTarget}",
    );
    expect(desktopSourceEditorSource).not.toContain("useMdxAiController");
    expect(desktopSourceEditorSource).not.toContain("requestDesktopAiContinuation");
  });
});
