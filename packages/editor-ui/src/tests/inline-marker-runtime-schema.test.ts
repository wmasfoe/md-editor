import { describe, expect, it } from "vitest";
import {
  collectMarkSchemaNames,
  REMOVED_MARK_NAMES,
  commonmarkKeepList,
  gfmKeepList,
} from "../components/MilkdownEditor/inlineMarkerPreset";

/**
 * T3 — schema 移除的运行时断言
 *
 * 验证 inlineMarkerPreset 重组后的 schema 在运行时确实不包含被移除的 4 个 inline mark。
 * 这是回归守护：防止 Milkdown 升级或配置变更意外恢复这些 mark。
 */
describe("inline mark removal — runtime schema assertion", () => {
  it("T3.1 — commonmark + gfm combined schema does not contain removed marks", () => {
    // 合并两个 keep-list 的 mark 键集
    const commonmarkMarks = collectMarkSchemaNames(commonmarkKeepList);
    const gfmMarks = collectMarkSchemaNames(gfmKeepList);
    const allMarks = new Set([...commonmarkMarks, ...gfmMarks]);

    // 4 个被移除的 mark 不应在合并后的 schema 中
    for (const removed of REMOVED_MARK_NAMES) {
      expect(allMarks.has(removed)).toBe(false);
    }

    // 确认 link mark 仍然存在（作为对照组）
    expect(allMarks.has("link")).toBe(true);
  });

  it("T3.2 — removed marks are explicitly excluded from both presets", () => {
    // 双重断言：两个 preset 的 mark 都不包含被移除项
    const commonmarkMarks = collectMarkSchemaNames(commonmarkKeepList);
    const gfmMarks = collectMarkSchemaNames(gfmKeepList);

    for (const removed of REMOVED_MARK_NAMES) {
      expect(commonmarkMarks).not.toContain(removed);
      expect(gfmMarks).not.toContain(removed);
    }
  });
});
