import { describe, expect, it } from "vitest";
import { serializeTableRow } from "../../src/wysiwyg/table-editing.ts";
import { splitTableRowCells } from "../../src/wysiwyg/table-projection.ts";

/** `serializeTableRow ∘ splitTableRowCells` 行往返 */
function roundTrip(row: string, leading: boolean): string {
  return serializeTableRow(splitTableRowCells(row, leading), leading);
}

/**
 * PM-4 举证义务（Architect 共识评审 pass-2 Nit-3 明确要求）。
 *
 * 背景：`table-widget.ts` 的 Tab 分支此前先 `flushCellCommit`（**文档变更**）再移动焦点，
 * 会破坏 T20「零文本变更」契约。D-1 的硬契约是**括号跳出先于任何 commit**。
 * 作为**纵深防御**，须证明「同文本提交是 no-op」的适用边界。
 *
 * ## 实测结论（本文件即回归锁，不得回退）
 *
 * | 行类 | 往返恒等？ | 含义 |
 * |---|---|---|
 * | 规范行（无 padding） | ✅ | 同文本提交确为 no-op（`commitTableCell` 的两道守卫生效） |
 * | padded / 尾随空格 | ❌ 被规范化 | **同文本提交会改文档** → PM-4 顺序契约**不可豁免** |
 * | 转义竖线 `\|` | ❌ **被二次转义** | 🔴 **新发现缺陷**，见下 |
 *
 * ## 🔴 新发现缺陷（超出 S1 范围，已登记为独立待办）
 *
 * `splitTableRowCells` **不**反转义 `\|`，而 `serializeTableRow` 的 `escapeTableCellText`
 * 会**再转义**一次 → 含转义竖线的单元格每 commit 一次就多一个反斜杠（数据膨胀）。
 * 例：`a \| b` → `a \\| b` → `a \\\\| b` …
 *
 * 本文件把它锁成特征化断言，使修复前后的差异可被二分定位。**不在 S1 内修**（超出范围、
 * 会污染 diff），已按 P5「先锁行为再改」留痕。
 */
describe("PM-4 举证：表格行往返恒等（serializeTableRow ∘ splitTableRowCells）", () => {
  it("规范行（无前导管道）往返恒等 → 同文本提交是 no-op", () => {
    expect(roundTrip("a | b", false)).toBe("a | b");
  });

  it("规范行（有前导管道）往返恒等 → 同文本提交是 no-op", () => {
    expect(roundTrip("| a | b |", true)).toBe("| a | b |");
  });

  it("🔴 非规范 padded 行被静默规范化 → PM-4 顺序契约不可豁免", () => {
    // E10/T20-cell 同款夹具
    expect(roundTrip("|  a  | b |", true)).toBe("| a | b |");
    expect(roundTrip("|  a  | b |", true)).not.toBe("|  a  | b |");
  });

  it("🔴 全 padded 行同样被规范化", () => {
    expect(roundTrip("|  a  |  b  |", true)).toBe("| a | b |");
  });

  it("🔴 尾随空格单元格同样被规范化", () => {
    expect(roundTrip("| a  | b |", true)).toBe("| a | b |");
  });

  it("🔴 特征化：转义竖线被二次转义（新发现缺陷，修复前锁定现状）", () => {
    // splitTableRowCells 不反转义 → serializeTableRow 再转义 → 反斜杠倍增
    expect(roundTrip("| a \\| b | c |", true)).toBe("| a \\\\| b | c |");
    expect(splitTableRowCells("| a \\| b | c |", true)).toEqual(["a \\| b", "c"]);
  });

  it("契约结论：PM-4 的『跳出先于 commit』是硬契约，不得以本举证为由豁免", () => {
    const canonical = roundTrip("| a | b |", true);
    const padded = roundTrip("|  a  | b |", true);
    // 规范行恒等 ≠ 全局恒等：非规范行存在，故顺序契约必须保持强制
    expect(canonical).toBe("| a | b |");
    expect(padded).not.toBe("|  a  | b |");
  });
});
