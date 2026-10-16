import { describe, expect, it } from "vitest";
import { MDX_SHOWCASE_SAMPLE, SHOWCASE_SAMPLES } from "../components/showcase-samples";

describe("showcase-samples syntax contracts", () => {
  it("focus sample contains highlight syntax in zh, en, zh-Hant, and ja", () => {
    const focusSample = SHOWCASE_SAMPLES.find((sample) => sample.id === "focus");
    expect(focusSample).toBeDefined();

    // 验证中文、英文、繁中与日文焦点样例均包含 ==高亮== 语法标记
    expect(focusSample?.markdownZh).toMatch(/==.+?==/);
    expect(focusSample?.markdownZhHant).toMatch(/==.+?==/);
    expect(focusSample?.markdownJa).toMatch(/==.+?==/);
    expect(focusSample?.markdownEn).toMatch(/==.+?==/);

    expect(focusSample?.markdownZh).toContain(
      "==试着点击此处，直接敲入你的文字，感受落笔生辉的质感...==",
    );
    expect(focusSample?.markdownZhHant).toContain(
      "==試著點擊此處，直接敲入你的文字，感受落筆生輝的質感...==",
    );
    expect(focusSample?.markdownJa).toContain(
      "==ここをクリックして文字を入力し、思考が形になる心地よさを体感してください...==",
    );
    expect(focusSample?.markdownEn).toContain(
      "==Click anywhere here to type, edit, or craft your next thought...==",
    );
  });

  it("mdx sample contains Callout component across all locales", () => {
    expect(MDX_SHOWCASE_SAMPLE.markdownZh).toContain('<Callout type="info"');
    expect(MDX_SHOWCASE_SAMPLE.markdownZhHant).toContain('<Callout type="info"');
    expect(MDX_SHOWCASE_SAMPLE.markdownJa).toContain('<Callout type="info"');
    expect(MDX_SHOWCASE_SAMPLE.markdownEn).toContain('<Callout type="info"');
  });
});
