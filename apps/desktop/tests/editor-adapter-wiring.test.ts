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
      "lineNumbers={settings.editor.showCodeBlockLineNumbers}",
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
