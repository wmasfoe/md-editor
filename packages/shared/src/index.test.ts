import { describe, expect, it } from "vitest";

import { err, normalizeLineEndings, ok } from "./index.ts";

describe("shared utilities", () => {
  it("normalizeLineEndings converts CRLF and CR to LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeLineEndings("already\nlf")).toBe("already\nlf");
  });

  it("ok creates a successful Result", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("err creates a failed Result", () => {
    const result = err("not-found", "File missing");
    expect(result).toEqual({ ok: false, error: "not-found", message: "File missing" });
  });
});
