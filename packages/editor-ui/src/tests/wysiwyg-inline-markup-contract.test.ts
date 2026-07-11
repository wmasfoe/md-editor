import { describe, expect, it } from "vitest";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";

function getPluginDisplayNames() {
  return [...commonmark, ...gfm]
    .map((plugin) => plugin.meta?.displayName)
    .filter((name): name is string => Boolean(name));
}

describe("WYSIWYG inline Markdown preset contracts", () => {
  it("provides semantic schemas for every source-edit syntax in scope", () => {
    const pluginNames = getPluginDisplayNames();

    expect(pluginNames).toEqual(
      expect.arrayContaining([
        "NodeSchema<heading>",
        "MarkSchema<strong>",
        "MarkSchema<emphasis>",
        "MarkSchema<strikethrough>",
        "NodeSchema<image>",
        "MarkSchema<link>",
        "MarkSchema<inlineCode>",
      ]),
    );
  });

  it("keeps link and image drafts outside Milkdown input-rule ownership", () => {
    const inputRules = getPluginDisplayNames().filter((name) => name.startsWith("InputRule<"));

    expect(inputRules).toEqual(
      expect.arrayContaining([
        "InputRule<wrapInHeadingInputRule>",
        "InputRule<emphasis>|Star",
        "InputRule<strong>",
        "InputRule<inlineCodeInputRule>",
        "InputRule<strikethrough>",
      ]),
    );
    expect(inputRules.some((name) => /link/iu.test(name))).toBe(false);
    expect(inputRules.some((name) => /image/iu.test(name))).toBe(false);
  });
});
