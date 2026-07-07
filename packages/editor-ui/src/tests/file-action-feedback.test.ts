import { describe, expect, it } from "vitest";
import { shouldShowFileActionOverlay } from "../hooks/useFileActionController";

describe("file action feedback", () => {
  it("keeps blocking overlay as the default for disruptive file operations", () => {
    expect(shouldShowFileActionOverlay()).toBe(true);
    expect(shouldShowFileActionOverlay({ feedback: "blocking" })).toBe(true);
  });

  it("allows ordinary saves to keep the editor surface stable", () => {
    expect(shouldShowFileActionOverlay({ feedback: "quiet" })).toBe(false);
  });
});
