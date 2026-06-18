import { describe, expect, it } from "vitest";
import { getLanguageSuggestions, planCodeBlockTabIndent } from "../utils/code-block-tools";

describe("code block tools", () => {
  it("plans tab insertion only inside code blocks", () => {
    expect(planCodeBlockTabIndent("paragraph", "", 4, 4)).toBeNull();
    expect(planCodeBlockTabIndent("code_block", "", 4, 4)).toEqual({
      from: 4,
      to: 4,
      text: "  "
    });
  });

  it("plans selected line indentation and outdentation", () => {
    expect(planCodeBlockTabIndent("code_block", "a\nb", 10, 13)).toEqual({
      from: 10,
      to: 13,
      text: "  a\n  b"
    });
    expect(planCodeBlockTabIndent("code_block", "  a\n\tb\nc", 10, 19, true)).toEqual({
      from: 10,
      to: 19,
      text: "a\nb\nc"
    });
  });

  it("suggests languages fuzzily while preserving free-form input elsewhere", () => {
    expect(getLanguageSuggestions("ts")).toContain("typescript");
    expect(getLanguageSuggestions("jx")).toContain("jsx");
    expect(getLanguageSuggestions("totally-custom-language")).toEqual([]);
  });
});
