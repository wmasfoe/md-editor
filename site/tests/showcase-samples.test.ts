import { describe, expect, it } from "vitest";
import { MDX_SHOWCASE_SAMPLE, SHOWCASE_SAMPLES } from "../components/showcase-samples";

describe("showcase-samples syntax contracts", () => {
  it("focus sample contains highlight syntax in both zh and en", () => {
    const focusSample = SHOWCASE_SAMPLES.find((sample) => sample.id === "focus");
    expect(focusSample).toBeDefined();

    // 验证中文与英文焦点样例均包含 ==高亮== 语法标记
    expect(focusSample?.markdownZh).toMatch(/==.+?==/);
    expect(focusSample?.markdownEn).toMatch(/==.+?==/);

    expect(focusSample?.markdownZh).toContain(
      "==试着点击此处，直接敲入你的文字，感受落笔生辉的质感...==",
    );
    expect(focusSample?.markdownEn).toContain(
      "==Click anywhere here to type, edit, or craft your next thought...==",
    );
  });

  it("mdx sample contains Callout component", () => {
    expect(MDX_SHOWCASE_SAMPLE.markdownZh).toContain('<Callout type="info"');
    expect(MDX_SHOWCASE_SAMPLE.markdownEn).toContain('<Callout type="info"');
  });
});
