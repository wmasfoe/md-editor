import { expect, test, type Page } from "@playwright/test";

const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
  await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function setMarkdown(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__MD_EDITOR_E2E__?.replaceDocument(source, "/fixtures/test.md", "wysiwyg");
  }, markdown);
  await expect.poll(async () => getMarkdown(page)).toBe(markdown);
}

async function getMarkdown(page: Page): Promise<string> {
  const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
  return diag?.renderer?.markdown ?? diag?.snapshot?.markdown ?? "";
}

test.describe("Thematic Break (---) WYSIWYG rendering and cursor fidelity", () => {
  test("renders exact number of lines before/after --- without phantom extra line", async ({
    page,
  }) => {
    await openApp(page);
    // User scenario: 2 empty lines before ---, and 2 empty lines after ---
    const markdown = "\n\n---\n\n";
    await setMarkdown(page, markdown);

    const thematicBreak = page.locator(".cm-md-thematic-break-widget");
    await expect(thematicBreak).toHaveCount(1);

    // Inspect the DOM children of .cm-content
    const childrenInfo = await page.evaluate(() => {
      const children = Array.from(document.querySelectorAll(".cm-content > *"));
      const hrIndex = children.findIndex((el) =>
        el.classList.contains("cm-md-thematic-break-widget"),
      );
      const linesBefore = children.slice(0, hrIndex);
      const linesAfter = children.slice(hrIndex + 1);
      return {
        totalCount: children.length,
        hrIndex,
        linesBeforeCount: linesBefore.length,
        linesAfterCount: linesAfter.length,
        linesBeforeAllCmLine: linesBefore.every((el) => el.classList.contains("cm-line")),
        linesAfterAllCmLine: linesAfter.every((el) => el.classList.contains("cm-line")),
      };
    });

    // There must be EXACTLY 2 cm-line elements before the hr, and 2 cm-line elements after!
    // Never 3 lines before!
    expect(childrenInfo.hrIndex).toBe(2);
    expect(childrenInfo.linesBeforeCount).toBe(2);
    expect(childrenInfo.linesAfterCount).toBe(2);
    expect(childrenInfo.linesBeforeAllCmLine).toBe(true);
    expect(childrenInfo.linesAfterAllCmLine).toBe(true);
  });

  test("vertical arrow keys navigate accurately into and out of thematic break without cursor drift", async ({
    page,
  }) => {
    await openApp(page);
    const markdown = "\n\n---\n\n";
    await setMarkdown(page, markdown);

    const thematicBreak = page.locator(".cm-md-thematic-break-widget");
    await expect(thematicBreak).toHaveCount(1);

    // Start cursor at position 0 (Line 1)
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.setSelection(0, 0));
    let diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(0);

    // ArrowDown moves from Line 1 to Line 2 (position 1)
    await page.keyboard.press("ArrowDown");
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(1);

    // ArrowDown from Line 2 enters thematic break and selects it
    await page.keyboard.press("ArrowDown");
    await expect(thematicBreak).toHaveAttribute("aria-selected", "true");
    await expect(thematicBreak).toHaveClass(/cm-md-thematic-break-widget--selected/u);

    // When the thematic break is selected, cursor must NOT be rendered on the line above.
    // 游标层（drawSelection）在 rAF 帧上落位：一次性取几何会读到上一帧旧位置（慢 CI 实证），
    // 改为短窗轮询；断言语义不变（真漂移会持续为 true → 轮询超时判失败）。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cursor = document.querySelector(".cm-cursor");
            const hr = document.querySelector(".cm-md-thematic-break-widget");
            if (!cursor || !hr) return false;
            const cursorRect = cursor.getBoundingClientRect();
            const hrRect = hr.getBoundingClientRect();
            // If cursor bottom is above hr top, cursor is placed on previous line
            return cursorRect.bottom < hrRect.top;
          }),
        { timeout: 2000, intervals: [50, 50, 100] },
      )
      .toBe(false);

    // ArrowDown again unselects thematic break (position collapses to 5)
    await page.keyboard.press("ArrowDown");
    await expect(thematicBreak).toHaveAttribute("aria-selected", "false");
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(5);

    // ArrowDown again moves to Line 4 (position 6)
    await page.keyboard.press("ArrowDown");
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(6);

    // ArrowUp enters thematic break backward and selects it
    await page.keyboard.press("ArrowUp");
    await expect(thematicBreak).toHaveAttribute("aria-selected", "true");
    await expect(thematicBreak).toHaveClass(/cm-md-thematic-break-widget--selected/u);

    // ArrowUp again collapses selection to start of thematic break (position 2)
    await page.keyboard.press("ArrowUp");
    await expect(thematicBreak).toHaveAttribute("aria-selected", "false");
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(2);

    // ArrowUp again moves to Line 2 (position 1)
    await page.keyboard.press("ArrowUp");
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.renderer?.selectionHead).toBe(1);
  });

  test("preserves cursor line consistency when switching between WYSIWYG and Source mode", async ({
    page,
  }) => {
    await openApp(page);
    const markdown = "\n\n---\n\n";
    await setMarkdown(page, markdown);

    const thematicBreak = page.locator(".cm-md-thematic-break-widget");
    // Click to select the thematic break
    await thematicBreak.click();
    await expect(thematicBreak).toHaveAttribute("aria-selected", "true");

    let diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    // In source string "\n\n---\n\n", "---" starts at index 2, length 3 -> ends at 5
    expect(diag?.renderer?.selectionAnchor).toBe(2);
    expect(diag?.renderer?.selectionHead).toBe(5);

    // Switch to source mode
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.setMode("source"));
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.snapshot?.mode).toBe("source");
    // In source mode, selection remains on Line 3 ("---")
    expect(diag?.renderer?.selectionAnchor).toBe(2);
    expect(diag?.renderer?.selectionHead).toBe(5);

    // Switch back to WYSIWYG mode
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.setMode("wysiwyg"));
    diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    expect(diag?.snapshot?.mode).toBe("wysiwyg");
    expect(diag?.renderer?.selectionAnchor).toBe(2);
    expect(diag?.renderer?.selectionHead).toBe(5);
    await expect(thematicBreak).toBeVisible();
  });

  test("deletes exact thematic break atom and restores on undo", async ({ page }) => {
    await openApp(page);
    const markdown = "\n\n---\n\n";
    await setMarkdown(page, markdown);

    const thematicBreak = page.locator(".cm-md-thematic-break-widget");
    await thematicBreak.click();
    await expect(thematicBreak).toHaveAttribute("aria-selected", "true");

    // Delete the thematic break
    await page.locator(".cm-content").press("Delete");
    await expect.poll(async () => getMarkdown(page)).toBe("\n\n\n\n");
    await expect(page.locator(".cm-md-thematic-break-widget")).toHaveCount(0);

    // Undo restores the thematic break
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect.poll(async () => getMarkdown(page)).toBe(markdown);
    await expect(page.locator(".cm-md-thematic-break-widget")).toHaveCount(1);
  });
});
