import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const desktopCodeMirrorSource = readFileSync(
  new URL("../src/components/DesktopCodeMirrorEditor.tsx", import.meta.url),
  "utf8",
);

describe("desktop editor adapter wiring", () => {
  it("mounts one persistent CodeMirror adapter for both editor modes", () => {
    expect(appSource.match(/<DesktopCodeMirrorEditor\b/gu)).toHaveLength(1);
    expect(appSource).not.toContain('snapshot.mode === "source"');
    expect(desktopCodeMirrorSource).toContain("<CodeMirrorEditor");
    expect(desktopCodeMirrorSource).toContain("document={runtime.document}");
    expect(desktopCodeMirrorSource).toContain("fontSize={settings.editor.wysiwygFontSize}");
    expect(desktopCodeMirrorSource).toContain(
      "codeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}",
    );
    // T-32：行内标记源码显隐开关必须从设置透传到编辑器（不得在适配层硬编码）。
    expect(desktopCodeMirrorSource).toContain(
      "showInlineStyleMarkers={settings.editor.showInlineStyleMarkers}",
    );
  });

  it("removes both legacy desktop adapters", () => {
    expect(
      existsSync(new URL("../src/components/DesktopMilkdownEditor.tsx", import.meta.url)),
    ).toBe(false);
    expect(existsSync(new URL("../src/components/DesktopSourceEditor.tsx", import.meta.url))).toBe(
      false,
    );
  });
});
