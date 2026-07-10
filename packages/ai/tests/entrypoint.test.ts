import { describe, expect, it } from "vitest";
import { createAiCacheKey, getAiCompletionReadiness } from "../src/index.ts";

describe("AI package entrypoint", () => {
  it("exposes platform-free AI capabilities", () => {
    expect(typeof getAiCompletionReadiness).toBe("function");
    expect(typeof createAiCacheKey).toBe("function");
  });
});
