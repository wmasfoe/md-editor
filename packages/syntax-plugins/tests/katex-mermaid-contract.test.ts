import { renderToString } from "katex";
import { describe, expect, it } from "vitest";

/**
 * mermaid → KaTeX 调用契约（KaTeX 版本收敛 O1-P1 的单元级守卫）。
 *
 * mermaid 11.x 的 `renderKatexUnsanitized` 只做一件事：
 *   katex.renderToString(c, { throwOnError: true, displayMode: true, output: <"mathml" | "htmlAndMathml"> })
 * （`output` 取决于运行环境的 MathML 支持与 `legacyMathML` 配置；mermaid 经 default 导出调用，
 *   与本测试使用的具名导出指向同一实现）。
 *
 * 仓库把 mermaid 的 katex 依赖 override 到与其余包一致的版本；本测试锁定该调用形状在新版本下
 * 仍然成立，避免出现「装得上但渲染即抛错」的静默破坏。浏览器侧的真实渲染证据见
 * `apps/desktop/e2e/codemirror-mermaid-math.spec.ts`。
 */
describe("mermaid → KaTeX 调用契约", () => {
  for (const output of ["mathml", "htmlAndMathml"] as const) {
    it(`renders mermaid 的调用形状（output=${output}）`, () => {
      const html = renderToString("x^2 + y^2 = z^2", {
        throwOnError: true,
        displayMode: true,
        output,
      });

      expect(html).toContain("katex");
      expect(html).not.toContain("katex-error");
    });
  }

  it("保留 throwOnError 语义（非法 TeX 必须抛错而不是静默降级）", () => {
    expect(() =>
      renderToString("\\invalidcommand{1}", {
        throwOnError: true,
        displayMode: true,
        output: "mathml",
      }),
    ).toThrow(/KaTeX|Undefined control sequence/u);
  });
});
