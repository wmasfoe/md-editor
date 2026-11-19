/**
 * AC2 手势判定的补充断言（architect R8 / code-reviewer L-3）：
 * 手势判定抽为纯函数后，覆盖 `0 / 阈值−1 / 阈值 / 阈值+1` 四个边界
 * （此前阈值内联，无法单测）。
 *
 * 原 AC12 E32 断言读取 `apps/desktop/e2e/codemirror-tab-decision.spec.ts` 的
 * `closest()` 例外分支。该 e2e 与 CM6 桌面宿主（Tauri）一并退役，GPUI 编辑器的
 * Tab 决策在 `packages/editor-gpui` 内实现，因此该文本级断言已无对应源码可测。
 */
import { describe, expect, it } from "vitest";
import { shouldOpenViewerFromClick } from "../src/mermaid/mermaid-projection.ts";

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
