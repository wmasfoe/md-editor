import { describe, expect, it } from "vitest";
import { renderMathToString, renderStaticHtml } from "../src/index.ts";

describe("KaTeX Offline Headless Rendering", () => {
  it("renders inline math without DOM dependencies", () => {
    const html = renderMathToString("c = \\pm\\sqrt{a^2 + b^2}", { displayMode: false });
    expect(html).toContain("katex");
    expect(html).toContain("katex-html");
    expect(html).not.toContain("katex-display");
  });

  it("renders display block math with displayMode", () => {
    const html = renderMathToString("\\int_0^\\infty e^{-x} dx = 1", { displayMode: true });
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });

  it("renders math inside full markdown document", () => {
    const md = `
# Math Note

Formula in text: $f(x) = x^2$.

$$
E = mc^2
$$
`;
    const result = renderStaticHtml(md);
    expect(result.html).toContain("math-inline");
    expect(result.html).toContain("math-display");
    expect(result.html).toContain("katex");
  });

  it("handles malformed math expression gracefully with error fallback", () => {
    const html = renderMathToString("\\invalidcommand{xyz", { displayMode: false });
    // KaTeX with throwOnError: false returns either an error span or safe fallback
    expect(html).toBeDefined();
    expect(html.length).toBeGreaterThan(0);
  });
});
