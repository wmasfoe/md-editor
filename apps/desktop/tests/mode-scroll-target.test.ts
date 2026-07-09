import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampEditorScrollRatio,
  createModeScrollTarget
} from "../../../packages/editor-ui/src/utils/editor-ui-state";

const controllerSource = readFileSync(
  new URL("../src/app/controller/useDesktopEditorController.ts", import.meta.url),
  "utf8"
);
const editorUiProviderSource = readFileSync(
  new URL("../../../packages/editor-ui/src/hooks/useEditorUi.tsx", import.meta.url),
  "utf8"
);
const editorUiSourceEditorSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/SourceEditor/SourceEditor.tsx", import.meta.url),
  "utf8"
);
const editorUiMilkdownEditorSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/MilkdownEditor/MilkdownEditor.tsx", import.meta.url),
  "utf8"
);
const desktopSourceEditorSource = readFileSync(
  new URL("../src/components/DesktopSourceEditor.tsx", import.meta.url),
  "utf8"
);
const desktopMilkdownEditorSource = readFileSync(
  new URL("../src/components/DesktopMilkdownEditor.tsx", import.meta.url),
  "utf8"
);

describe("mode switch scroll target", () => {
  it("clamps scroll ratios before creating a cross-mode target", () => {
    expect(clampEditorScrollRatio(Number.NaN)).toBeNull();
    expect(clampEditorScrollRatio(-0.4)).toBe(0);
    expect(clampEditorScrollRatio(0.42)).toBe(0.42);
    expect(clampEditorScrollRatio(1.8)).toBe(1);

    expect(createModeScrollTarget("source", 0.42, 123)).toEqual({
      mode: "source",
      target: {
        ratio: 0.42,
        nonce: 123
      }
    });
  });

  it("keeps the scroll target alive until the target editor applies it", () => {
    expect(controllerSource).toContain("startModeScrollTarget(mode)");
    expect(controllerSource).toContain("clearModeScrollTarget()");
    expect(editorUiProviderSource).toContain("setModeScrollTarget(createModeScrollTarget(mode, activeScrollRatioRef.current))");
    expect(editorUiProviderSource).toContain("current?.target.nonce === nonce ? null : current");
  });

  it("keeps mode-specific scroll targets in editor-ui instead of desktop stores", () => {
    expect(editorUiSourceEditorSource).toContain('getModeScrollTargetForMode(editorUiState.modeScrollTarget, "source")');
    expect(editorUiMilkdownEditorSource).toContain('getModeScrollTargetForMode(editorUiState.modeScrollTarget, "wysiwyg")');
    expect(desktopSourceEditorSource).not.toContain('modeScrollTarget?.mode === "source"');
    expect(desktopMilkdownEditorSource).not.toContain('modeScrollTarget?.mode === "wysiwyg"');
    expect(desktopSourceEditorSource).not.toContain("onScrollRatioChange={updateModeScrollRatio}");
    expect(desktopMilkdownEditorSource).not.toContain("onScrollTargetApplied={completeModeScrollTarget}");
  });

  it("lets mode restoration override stale TOC jumps in both editors", () => {
    expect(editorUiSourceEditorSource).toContain("onScrollTargetApplied={editorUiActions.completeModeScrollTarget}");
    expect(editorUiMilkdownEditorSource).toContain("onScrollTargetApplied: editorUiActions.completeModeScrollTarget");
  });
});
