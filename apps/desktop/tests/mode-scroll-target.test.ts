import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampEditorScrollRatio,
  createModeScrollTarget
} from "../src/app/controller/mode-scroll-target";

const appSource = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const controllerSource = readFileSync(
  new URL("../src/app/controller/useDesktopEditorController.ts", import.meta.url),
  "utf8"
);
const sourceEditorSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/SourceEditor.tsx", import.meta.url),
  "utf8"
);
const milkdownEditorSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/MilkdownEditor.tsx", import.meta.url),
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
    expect(controllerSource).toContain("createModeScrollTarget(mode, activeScrollRatioRef.current)");
    expect(controllerSource).toContain("completeModeScrollTarget");
    expect(controllerSource).toContain("current?.target.nonce === nonce ? null : current");
  });

  it("passes mode-specific scroll targets to source and WYSIWYG editors", () => {
    expect(appSource).toContain('editor.modeScrollTarget?.mode === "source"');
    expect(appSource).toContain('editor.modeScrollTarget?.mode === "wysiwyg"');
    expect(appSource).toContain("onScrollRatioChange={editor.updateModeScrollRatio}");
    expect(appSource).toContain("onScrollTargetApplied={editor.completeModeScrollTarget}");
  });

  it("lets mode restoration override stale TOC jumps in both editors", () => {
    expect(sourceEditorSource).toContain("if (scrollTarget || target === null || !editorView.current)");
    expect(milkdownEditorSource).toContain("if (scrollTarget || !target || !rootRef.current)");
    expect(sourceEditorSource).toContain("onScrollTargetApplied?.(scrollTarget.nonce)");
    expect(milkdownEditorSource).toContain("onScrollTargetApplied?.(scrollTarget.nonce)");
  });
});
