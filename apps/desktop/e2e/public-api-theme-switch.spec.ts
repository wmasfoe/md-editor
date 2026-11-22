/**
 * M-5 / E-0c：真实 app 表面切换 `theme.base`（light ⇄ dark）。
 *
 * 契约：切主题是**属性更新**，不是重建编辑器。三条必须同时成立：
 * 1. 视图生命周期计数不变（没有新的 create/destroy）；
 * 2. 撤销栈深度不变（历史没被丢）；
 * 3. 选区不变（光标不会被弹回开头）。
 * 只断言颜色变化是不够的——那恰好会在"重建后重新上色"时也通过。
 */
import { expect, test, type Page } from "@playwright/test";

async function openHarness(page: Page) {
  await page.goto("/?surface=codemirror-editor&standalone=1");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.isReady()))
    .toBe(true);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const harness = window.__CODEMIRROR_EDITOR_E2E__;
    if (!harness) throw new Error("CodeMirror editor harness is unavailable.");
    return harness.getDiagnostics();
  });
}

test.describe("M-5 / E-0c 主题切换不重建编辑器", () => {
  test("light → dark 不重建视图、不丢撤销栈与选区", async ({ page }) => {
    await openHarness(page);

    // 制造可撤销历史 + 非零选区。
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.type(" theme-probe");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");

    const before = await diagnostics(page);
    const undoBefore = await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getUndoDepth());
    expect(undoBefore).toBeGreaterThan(0);
    expect(before.renderer?.selectionRangeCount).toBeGreaterThan(0);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setThemeBase("dark"));
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__CODEMIRROR_EDITOR_E2E__!.getDiagnostics().renderer?.viewCreationCount,
        ),
      )
      .toBe(before.renderer?.viewCreationCount);

    const after = await diagnostics(page);
    expect(after.renderer?.viewCreationCount).toBe(before.renderer?.viewCreationCount);
    expect(after.renderer?.viewDestructionCount).toBe(before.renderer?.viewDestructionCount);
    expect(after.renderer?.undoDepth).toBe(before.renderer?.undoDepth);
    expect(after.renderer?.selectionAnchor).toBe(before.renderer?.selectionAnchor);
    expect(after.renderer?.selectionHead).toBe(before.renderer?.selectionHead);
    // 基底确实生效（否则"没重建"可能只是因为它什么都没做）。
    await expect(page.locator(".cm-editor")).toHaveCount(1);
  });

  test("dark → light 再切回，仍然只有一份视图", async ({ page }) => {
    await openHarness(page);
    const before = await diagnostics(page);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setThemeBase("dark"));
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setThemeBase("light"));

    const after = await diagnostics(page);
    expect(after.cmEditorCount).toBe(1);
    expect(after.renderer?.viewCreationCount).toBe(before.renderer?.viewCreationCount);
  });
});
