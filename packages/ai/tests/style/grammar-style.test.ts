import { describe, expect, it } from "vitest";
import {
  applyStyleToGrammarDiffs,
  buildStyleSuggestions,
  conflictsWithStyle,
  mergeStyleProfile,
  type StyleRuleRecord,
} from "../../src/style/index.ts";

function profile(rules: Array<[StyleRuleRecord["dimension"], string]>) {
  return mergeStyleProfile({
    workspace: rules.map(([dimension, value]) => ({
      dimension,
      value,
      status: "active",
      rounds: [],
    })),
  });
}

const diff = (start: number, original: string, replacement: string) => ({
  start,
  end: start + original.length,
  utf16From: start,
  utf16To: start + original.length,
  original,
  replacement,
});

describe("grammar fixes with writing preferences", () => {
  it("U-GEC-1: keep-english drops diffs that translate an English term into Chinese", () => {
    const p = profile([["termScript", "keep-english"]]);
    expect(conflictsWithStyle(diff(0, "React", "反应"), p)).toBe(true);
    expect(conflictsWithStyle(diff(0, "Reakt", "React"), p)).toBe(false);
    expect(conflictsWithStyle(diff(0, "因该", "应该"), p)).toBe(false);
    expect(conflictsWithStyle(diff(0, "React", "反应"), undefined)).toBe(false);
  });

  it("U-GEC-2: spacing preference produces style suggestions and drops opposite fixes", () => {
    const spaced = profile([["cjkLatinSpacing", "spaced"]]);
    const text = "我们用React写界面，用 Vite 打包。";
    expect(buildStyleSuggestions(text, spaced)).toEqual([
      expect.objectContaining({ original: "用R", replacement: "用 R", kind: "style", start: 2 }),
      expect.objectContaining({ original: "t写", replacement: "t 写", kind: "style" }),
    ]);
    expect(conflictsWithStyle(diff(0, "用 Vite", "用Vite"), spaced)).toBe(true);
    expect(conflictsWithStyle(diff(0, "用Vite", "用 Vite"), spaced)).toBe(false);

    const unspaced = profile([["cjkLatinSpacing", "unspaced"]]);
    expect(buildStyleSuggestions("用 Vite 打包", unspaced).map((s) => s.replacement)).toEqual([
      "用V",
      "e打",
    ]);
    expect(conflictsWithStyle(diff(0, "用Vite", "用 Vite"), unspaced)).toBe(true);
  });

  it("U-GEC-2: punctuation width suggestions skip code, links and decimals", () => {
    const full = profile([["cjkPunctuationWidth", "fullwidth"]]);
    const text = "今天下雨了,我们 `中,文` 版本是1.5,见[说明](http://x.com/中,b)结束.";
    const suggestions = buildStyleSuggestions(text, full);
    expect(suggestions.map((s) => [s.start, s.original, s.replacement])).toEqual([
      [5, ",", "，"],
      [text.length - 1, ".", "。"],
    ]);
    expect(conflictsWithStyle(diff(0, "了，", "了,"), full)).toBe(true);
    expect(conflictsWithStyle(diff(0, "了,", "了，"), full)).toBe(false);
  });

  it("U-GEC-2: fixes and style suggestions stay separate and never overlap", () => {
    const p = profile([
      ["cjkLatinSpacing", "spaced"],
      ["termScript", "keep-english"],
    ]);
    const text = "我门用React写界面";
    const merged = applyStyleToGrammarDiffs(
      text,
      [diff(0, "我门", "我们"), diff(3, "React", "反应")],
      p,
    );
    expect(merged.map((d) => [d.kind, d.original, d.replacement])).toEqual([
      ["fix", "我门", "我们"],
      ["style", "用R", "用 R"],
      ["style", "t写", "t 写"],
    ]);
  });

  it("U-GEC-3: without a profile the diffs are unchanged and no style suggestions appear", () => {
    const fixes = [diff(0, "我门", "我们")];
    expect(applyStyleToGrammarDiffs("我门用React", fixes, undefined)).toEqual([
      { ...fixes[0], kind: "fix" },
    ]);
  });

  it("U-GEC-4: custom rules override the AI value used by the post-filter", () => {
    const overridden = mergeStyleProfile({
      workspace: [{ dimension: "cjkLatinSpacing", value: "spaced", status: "active", rounds: [] }],
      custom: [{ kind: "dimension", id: "c1", dimension: "cjkLatinSpacing", value: "unspaced" }],
    });
    expect(conflictsWithStyle(diff(0, "用Vite", "用 Vite"), overridden)).toBe(true);
    const disabled = mergeStyleProfile({
      workspace: [{ dimension: "cjkLatinSpacing", value: "spaced", status: "active", rounds: [] }],
      custom: [{ kind: "dimension", id: "c1", dimension: "cjkLatinSpacing", value: "none" }],
    });
    expect(buildStyleSuggestions("用React", disabled)).toEqual([]);
  });
});
