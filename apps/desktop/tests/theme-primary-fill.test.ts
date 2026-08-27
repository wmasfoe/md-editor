import { primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { describe, expect, it } from "vitest";
import { builtInThemeCss } from "../src/app/settings/built-in-themes";

describe("primary button theme token", () => {
  it.each(["night-dark", "charcoal-dark"] as const)(
    "keeps dark filled controls separate from bright accent content for %s",
    (themeId) => {
      const themeCss = builtInThemeCss(themeId);
      const accent = readHexToken(themeCss, "--theme-primary");
      const fill = readHexToken(themeCss, "--theme-primary-fill");

      expect(fill).not.toBe(accent);
      expect(contrastRatio(fill, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("applies primary button token classes to dialog controls", () => {
    expect(primaryDialogButtonClassName).toContain("var(--theme-primary-fill)");
    expect(primaryDialogButtonClassName).toContain("focus-visible:outline-[var(--theme-primary)]");
  });

  it.each(["github-light", "gothic-light", "paper-light"] as const)(
    "lets %s filled controls inherit that theme's accent",
    (themeId) => {
      expect(builtInThemeCss(themeId)).toContain("--theme-primary-fill: var(--theme-primary)");
    },
  );
});

function readHexToken(css: string, token: string): string {
  const value = css.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing hexadecimal theme token: ${token}`);
  return value;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
