import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampEditorScrollRatio,
  createModeScrollTarget
} from "../src/app/controller/mode-scroll-target";

const controllerSource = readFileSync(
  new URL("../src/app/controller/useDesktopEditorController.ts", import.meta.url),
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
    expect(controllerSource).toContain("createModeScrollTarget(mode, activeScrollRatioRef.current)");
    expect(controllerSource).toContain("completeModeScrollTarget");
    // completeModeScrollTarget now writes to editorScrollStore, clearing target when nonce matches
    expect(controllerSource).toContain("modeScrollTarget?.target.nonce === nonce");
  });

  it("passes mode-specific scroll targets to source and WYSIWYG editors", () => {
    // 模式滚动目标现在由各自的自治编辑器组件直接从 editorScrollStore 读取
    expect(desktopSourceEditorSource).toContain('modeScrollTarget?.mode === "source"');
    expect(desktopMilkdownEditorSource).toContain('modeScrollTarget?.mode === "wysiwyg"');
    expect(desktopSourceEditorSource).toContain("onScrollRatioChange={updateModeScrollRatio}");
    expect(desktopMilkdownEditorSource).toContain("onScrollTargetApplied={completeModeScrollTarget}");
  });

  it("lets mode restoration override stale TOC jumps in both editors", () => {
    expect(desktopSourceEditorSource).toContain("onScrollTargetApplied={completeModeScrollTarget}");
    expect(desktopMilkdownEditorSource).toContain("onScrollTargetApplied={completeModeScrollTarget}");
  });
});
