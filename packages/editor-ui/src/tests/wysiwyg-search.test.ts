import { describe, expect, it } from "vitest";
import {
  findTextOccurrences,
  revealActiveWysiwygSearchMatch
} from "../utils/wysiwyg-search";

describe("findTextOccurrences", () => {
  it("finds every non-overlapping match without case sensitivity by default", () => {
    expect(findTextOccurrences("Markdown markdown MARKDOWN", "markdown")).toEqual([
      { from: 0, to: 8 },
      { from: 9, to: 17 },
      { from: 18, to: 26 }
    ]);
  });

  it("supports case-sensitive matching", () => {
    expect(findTextOccurrences("Find find", "Find", true)).toEqual([{ from: 0, to: 4 }]);
  });

  it("returns no matches for an empty query", () => {
    expect(findTextOccurrences("content", "")).toEqual([]);
  });

  it("centers the active match after decorations render", () => {
    let receivedOptions: ScrollIntoViewOptions | undefined;
    const activeMatch = {
      scrollIntoView(options?: ScrollIntoViewOptions) {
        receivedOptions = options;
      }
    };
    const root = {
      querySelector(selector: string) {
        return selector === ".wysiwyg-search-match--active" ? activeMatch : null;
      }
    } as unknown as ParentNode;

    revealActiveWysiwygSearchMatch(root, (callback) => callback());

    expect(receivedOptions).toEqual({
      block: "center",
      inline: "nearest",
      behavior: "auto"
    });
  });
});
