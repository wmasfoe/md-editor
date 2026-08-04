import { expect, test, type Page } from "@playwright/test";

const LINK_MARKDOWN = "[text](https://example.com)";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()))
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const harness = window.__CODEMIRROR_EDITOR_E2E__;
    if (!harness) throw new Error("CodeMirror editor harness is unavailable.");
    return harness.getDiagnostics();
  });
}

async function setCompositionActive(page: Page, active: boolean): Promise<void> {
  await page.evaluate((nextActive) => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content is not mounted.");
    content.dispatchEvent(
      new CompositionEvent(nextActive ? "compositionstart" : "compositionend", { bubbles: true }),
    );
  }, active);
}

test.describe("CodeMirror G004 input lifecycle", () => {
  test("G004-E00: plain text input maps projection and visible marks without rebuilding", async ({
    page,
  }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("**bold**\n\nPlain", "wysiwyg");
    });
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Control+End");
    const before = await diagnostics(page);
    await page.keyboard.type("x");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe("**bold**\n\nPlainx");
    const after = await diagnostics(page);
    expect(after.renderer?.wysiwyg.projectionMapSkipCount).toBe(
      (before.renderer?.wysiwyg.projectionMapSkipCount ?? 0) + 1,
    );
    expect(after.renderer?.wysiwyg.visibleMarkMapSkipCount).toBe(
      (before.renderer?.wysiwyg.visibleMarkMapSkipCount ?? 0) + 1,
    );
    expect(after.renderer?.wysiwyg.fullProjectionBuildCount).toBe(
      before.renderer?.wysiwyg.fullProjectionBuildCount,
    );
  });

  test("G004-E01: link typedBoundary reveal clears when editor loses focus", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("", "wysiwyg");
    });

    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.type(LINK_MARKDOWN);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(LINK_MARKDOWN);
    await expect
      .poll(
        async () => (await diagnostics(page)).renderer?.wysiwygProjection.activeSyntaxIds.length,
      )
      .toBeGreaterThan(0);

    await page.evaluate(() => {
      const focusTarget = document.createElement("button");
      focusTarget.id = "g004-focus-target";
      focusTarget.textContent = "focus target";
      document.body.append(focusTarget);
    });
    await page.locator("#g004-focus-target").focus();
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.wysiwygProjection.activeSyntaxIds)
      .toEqual([]);
  });

  test("G004-E02: compositionend rebuilds visible marks exactly once", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("Hello", "wysiwyg");
    });
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Control+End");
    const before = await diagnostics(page);

    await setCompositionActive(page, true);
    await page.keyboard.insertText("中");
    const during = await diagnostics(page);
    expect(during.renderer?.wysiwyg.visibleMarkBuildCount).toBe(
      before.renderer?.wysiwyg.visibleMarkBuildCount,
    );

    await setCompositionActive(page, false);
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.wysiwyg.visibleMarkBuildCount)
      .toBe((during.renderer?.wysiwyg.visibleMarkBuildCount ?? 0) + 1);
  });

  test("G004-E03: input inside an inline marker rebuilds visible marks", async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("**bold**", "wysiwyg");
      window.__CODEMIRROR_EDITOR_E2E__?.setMode("source");
    });
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await diagnostics(page)).renderer?.selectionHead).toBe(1);
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));
    const before = await diagnostics(page);

    await page.keyboard.insertText("x");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe("*x*bold**");
    const after = await diagnostics(page);
    expect(after.renderer?.wysiwyg.visibleMarkMapSkipCount).toBe(
      before.renderer?.wysiwyg.visibleMarkMapSkipCount,
    );
    // 核心语义:marker 内输入不走快速路径、必然重建。慢环境(macOS CI)下
    // mode 切换/geometry 更新可能触发多次重建,故断言"至少一次"而非恰好一次。
    expect(after.renderer?.wysiwyg.visibleMarkBuildCount ?? 0).toBeGreaterThan(
      before.renderer?.wysiwyg.visibleMarkBuildCount ?? 0,
    );
  });
});
