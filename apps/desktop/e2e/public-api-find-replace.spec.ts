/**
 * B-4：查找 / 替换面板（`ports.openFind` / `openReplace`）。
 *
 * 为什么只能在 e2e：`openSearchPanel` 需要真实的 `view.plugin`，测试 harness 的
 * state 适配器没有它（见 `packages/editor/tests/ports-baseline.test.ts` 的说明）。
 *
 * 三条不能退让的语义：面板能打开、焦点落在面板内（否则用户要再点一次）、Escape 能关掉。
 */
import { expect, test, type Page } from "@playwright/test";

async function openHarness(page: Page) {
  await page.goto("/?surface=codemirror-editor&standalone=1");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.isReady()))
    .toBe(true);
}

test.describe("B-4 查找与替换面板", () => {
  test("openFind 打开面板且焦点落在面板内", async ({ page }) => {
    await openHarness(page);
    await page.locator(".cm-content").click();

    const opened = await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.openFind());
    expect(opened).toBe(true);

    await expect(page.locator(".cm-search-liquid-panel")).toBeVisible();
    // 焦点必须在面板里：否则键盘输入继续落进正文，用户会以为面板没生效。
    await expect
      .poll(() =>
        page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getSearchPanelState().focusedInside),
      )
      .toBe(true);
  });

  test("openReplace 打开替换面板", async ({ page }) => {
    await openHarness(page);
    await page.locator(".cm-content").click();

    expect(await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.openReplace())).toBe(true);
    await expect(page.locator(".cm-search-liquid-panel")).toBeVisible();
  });

  test("Escape 关闭面板且正文恢复可编辑", async ({ page }) => {
    await openHarness(page);
    await page.locator(".cm-content").click();
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.openFind());
    await expect(page.locator(".cm-search-liquid-panel")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-search-liquid-panel")).toHaveCount(0);

    await page.locator(".cm-content").click();
    await page.keyboard.type("Z");
    await expect(page.locator(".cm-content")).toContainText("Z");
  });
});
