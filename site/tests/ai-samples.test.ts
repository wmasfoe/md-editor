import { describe, expect, it } from "vitest";
import { SHOWCASE_AI_FLOW_DATA } from "../components/showcase-ai-samples";

describe("SHOWCASE_AI_FLOW_DATA contract", () => {
  it("contains valid sequential flow data for zh and en", () => {
    for (const lang of ["zh", "en"] as const) {
      const data = SHOWCASE_AI_FLOW_DATA[lang];
      expect(data).toBeDefined();

      // 验证阶段 1：语法与标点纠错预设
      expect(data.initialMarkdown.trim().length).toBeGreaterThan(20);
      expect(data.grammarItems.length).toBeGreaterThanOrEqual(3);

      // 验证坐标精确匹配原文，确保 CodeMirror 选区 100% 准确
      data.grammarItems.forEach((item) => {
        expect(item.from).toBeLessThan(item.to);
        expect(item.text).toBeTruthy();
        expect(item.originalText).toBeTruthy();
        expect(item.text).not.toBe(item.originalText);

        // 原文切片必须与 originalText 完全一致
        const slice = data.initialMarkdown.slice(item.from, item.to);
        expect(slice).toBe(item.originalText);
      });

      // 验证序号有序递增，无重叠
      for (let i = 1; i < data.grammarItems.length; i++) {
        expect(data.grammarItems[i].from).toBeGreaterThanOrEqual(data.grammarItems[i - 1].to);
      }

      // 验证阶段 2：行内续写预设
      expect(data.continuationOnlyMarkdown.trim().length).toBeGreaterThan(5);
      expect(data.continuationSteps.length).toBeGreaterThanOrEqual(3);

      data.continuationSteps.forEach((step, idx) => {
        expect(step.stepIndex).toBe(idx);
        expect(step.text.trim().length).toBeGreaterThan(0);
      });
    }
  });
});
