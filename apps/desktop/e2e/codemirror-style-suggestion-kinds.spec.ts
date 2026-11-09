import { expect, test } from "@playwright/test";
import { loadDoc, openFullApp, readDoc, setCaret } from "./editor-e2e-helpers";

/**
 * E-3：语法与润色修复建议分“修正”与“风格”两类展示，Tab 接受与 Esc 取消行为一致。
 */
test.describe("E-3: fix and style suggestion kinds", () => {
  test.beforeEach(async ({ page }) => {
    await openFullApp(page);
  });

  test("labels fix and style suggestions and accepts them with Tab", async ({ page }) => {
    await loadDoc(page, "我门用React写界面。");
    await setCaret(page, 0);
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__!.showSuggestion({
        items: [
          { from: 0, to: 2, text: "我们", originalText: "我门", kind: "fix" },
          { from: 2, to: 4, text: "用 R", originalText: "用R", kind: "style" },
        ],
        activeIndex: 0,
      });
    });

    await expect(page.locator(".cm-md-ai-badge").first()).toContainText("修正");
    expect(await page.evaluate(() => window.__MD_EDITOR_E2E__!.getSuggestionKinds())).toEqual([
      "fix",
      "style",
    ]);

    await page.keyboard.press("Tab");
    await expect(page.locator(".cm-md-ai-badge").first()).toContainText("风格");
    await page.keyboard.press("Tab");
    const markdown = await readDoc(page);
    expect(markdown).toContain("我们用 R写界面");
  });

  test("Esc dismisses style suggestions without changing the document", async ({ page }) => {
    const before = "我门用React写界面。";
    await loadDoc(page, before);
    await setCaret(page, 0);
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__!.showSuggestion({
        items: [{ from: 2, to: 4, text: "用 R", originalText: "用R", kind: "style" }],
        activeIndex: 0,
      });
    });

    await expect(page.locator(".cm-md-ai-badge").first()).toContainText("风格");
    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-md-ai-badge")).toHaveCount(0);
    expect(await readDoc(page)).toBe(before);
  });
});
