/**
 * AC2 / AC12 的补充断言（architect R8 / code-reviewer L-3）：
 * - 手势判定抽为纯函数后，覆盖 `0 / 阈值−1 / 阈值 / 阈值+1` 四个边界（此前阈值内联，无法单测）；
 * - E32 的 `closest()` 例外分支不得新增 mermaid 条目（规范要求"不得扩例外"，
 *   而这条约束此前只在 PRD 里，没有可失败的断言）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldOpenViewerFromClick } from "../src/mermaid/mermaid-projection.ts";

const TAB_DECISION_SPEC = fileURLToPath(
  new URL("../../../apps/desktop/e2e/codemirror-tab-decision.spec.ts", import.meta.url),
);

describe("AC2 手势判定（纯函数边界）", () => {
  it("仅原地单击（detail=1 且位移在阈值内）才打开查看器", () => {
    expect(shouldOpenViewerFromClick(1, 0)).toBe(true);
    expect(shouldOpenViewerFromClick(1, 3)).toBe(true);
    expect(shouldOpenViewerFromClick(1, 4)).toBe(true);
    expect(shouldOpenViewerFromClick(1, 5)).toBe(false);
  });

  it("双击（detail=2）与多击不打开查看器", () => {
    expect(shouldOpenViewerFromClick(2, 0)).toBe(false);
    expect(shouldOpenViewerFromClick(3, 0)).toBe(false);
  });
});

describe("AC12 E32 例外清单不得新增 mermaid 条目", () => {
  it("codemirror-tab-decision.spec.ts 的 closest() 例外分支不含 mermaid 容器", () => {
    const source = readFileSync(TAB_DECISION_SPEC, "utf-8");
    const exceptionSelectors = source.match(/!element\.closest\("[^"]+"\)/gu) ?? [];
    expect(exceptionSelectors.length).toBeGreaterThan(0);
    expect(exceptionSelectors.some((entry) => entry.includes("mermaid"))).toBe(false);
  });
});
