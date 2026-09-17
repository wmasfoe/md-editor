import { expect, test, type Page } from "@playwright/test";

async function openAppWithLongDoc(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
  await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
  await expect(page.locator(".cm-editor")).toHaveCount(1);

  // Generate a document with 80 sections
  const longDoc = Array.from(
    { length: 80 },
    (_, i) => `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with some descriptive text.\n`,
  ).join("\n");

  await page.evaluate((source) => {
    window.__MD_EDITOR_E2E__?.replaceDocument(source, "/fixtures/scroll-test.md", "wysiwyg");
  }, longDoc);

  await expect
    .poll(async () => {
      const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
      return diag?.renderer?.markdown ?? "";
    })
    .toBe(longDoc);
}

async function getCursorGeometry(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller");
    const cursor = document.querySelector(".cm-cursor");
    if (!scroller || !cursor) {
      return null;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const cursorRect = cursor.getBoundingClientRect();
    return {
      cursorTop: cursorRect.top,
      cursorBottom: cursorRect.bottom,
      scrollerTop: scrollerRect.top,
      scrollerBottom: scrollerRect.bottom,
      relativeOffset: cursorRect.top - scrollerRect.top,
    };
  });
}

test.describe("Editor mode switch viewport and cursor retention", () => {
  test("preserves cursor visibility and relative screen position when switching WYSIWYG -> Source", async ({
    page,
  }) => {
    await openAppWithLongDoc(page);
    const editor = page.locator(".cm-editor");
    await expect(editor).toHaveAttribute("data-editor-mode", "wysiwyg");

    // Scroll and position cursor on line 80 (middle of the document)
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__?.scrollToLine(80, { select: true, focus: true });
    });
    await page.waitForTimeout(100);

    const beforeGeometry = await getCursorGeometry(page);
    expect(beforeGeometry).not.toBeNull();
    expect(beforeGeometry!.cursorBottom).toBeGreaterThanOrEqual(beforeGeometry!.scrollerTop);
    expect(beforeGeometry!.cursorTop).toBeLessThanOrEqual(beforeGeometry!.scrollerBottom);

    // Switch to Source mode via standard mode switch command
    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__?.setMode("source");
    });
    await expect(editor).toHaveAttribute("data-editor-mode", "source");

    await page.waitForTimeout(150);

    const afterGeometry = await getCursorGeometry(page);
    expect(afterGeometry).not.toBeNull();
    // Cursor MUST remain inside the visible viewport:
    expect(afterGeometry!.cursorBottom).toBeGreaterThanOrEqual(afterGeometry!.scrollerTop);
    expect(afterGeometry!.cursorTop).toBeLessThanOrEqual(afterGeometry!.scrollerBottom);

    // Relative vertical position on screen should be anchored (within 2px tolerance)
    expect(
      Math.abs(afterGeometry!.relativeOffset - beforeGeometry!.relativeOffset),
    ).toBeLessThanOrEqual(2);
  });

  test("preserves cursor visibility and relative screen position when switching Source -> WYSIWYG", async ({
    page,
  }) => {
    await openAppWithLongDoc(page);
    const editor = page.locator(".cm-editor");

    // Start in Source mode
    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__?.setMode("source");
    });
    await expect(editor).toHaveAttribute("data-editor-mode", "source");

    // Scroll and position cursor on line 90 (middle of the document)
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__?.scrollToLine(90, { select: true, focus: true });
    });
    await page.waitForTimeout(100);

    const beforeGeometry = await getCursorGeometry(page);
    expect(beforeGeometry).not.toBeNull();
    expect(beforeGeometry!.cursorBottom).toBeGreaterThanOrEqual(beforeGeometry!.scrollerTop);
    expect(beforeGeometry!.cursorTop).toBeLessThanOrEqual(beforeGeometry!.scrollerBottom);

    // Switch back to WYSIWYG mode
    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__?.setMode("wysiwyg");
    });
    await expect(editor).toHaveAttribute("data-editor-mode", "wysiwyg");

    await page.waitForTimeout(150);

    const afterGeometry = await getCursorGeometry(page);
    expect(afterGeometry).not.toBeNull();
    // Cursor MUST remain inside the visible viewport:
    expect(afterGeometry!.cursorBottom).toBeGreaterThanOrEqual(afterGeometry!.scrollerTop);
    expect(afterGeometry!.cursorTop).toBeLessThanOrEqual(afterGeometry!.scrollerBottom);

    // Relative vertical position on screen should be anchored (within 2px tolerance)
    expect(
      Math.abs(afterGeometry!.relativeOffset - beforeGeometry!.relativeOffset),
    ).toBeLessThanOrEqual(2);
  });

  test("preserves reading position when cursor is off-screen without jerking viewport", async ({
    page,
  }) => {
    await openAppWithLongDoc(page);
    const editor = page.locator(".cm-editor");
    const scroller = page.locator(".cm-scroller");

    // Place cursor at line 1 (top of the document)
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__?.scrollToLine(1, { select: true, focus: true });
    });

    // Now scroll the viewport far down to middle (scrollTop = 1500), leaving cursor off-screen at top
    await scroller.evaluate((el) => {
      el.scrollTop = 1500;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(100);

    // Verify cursor is NOT in viewport right now
    const cursorInViewport = await page.evaluate(() => {
      const scrollerEl = document.querySelector(".cm-scroller");
      const cursorEl = document.querySelector(".cm-cursor");
      if (!scrollerEl || !cursorEl) {
        return false;
      }
      const sRect = scrollerEl.getBoundingClientRect();
      const cRect = cursorEl.getBoundingClientRect();
      return cRect.bottom >= sRect.top && cRect.top <= sRect.bottom;
    });
    expect(cursorInViewport).toBe(false);

    // Switch mode to Source
    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__?.setMode("source");
    });
    await expect(editor).toHaveAttribute("data-editor-mode", "source");

    await page.waitForTimeout(150);

    // Verify the viewport is NOT jerked back to top (where cursor was)
    const afterScrollTop = await page.evaluate(() => {
      const scrollerEl = document.querySelector(".cm-scroller");
      return scrollerEl?.scrollTop ?? 0;
    });

    // Viewport should remain scrolled down (not pulled back to 0)
    expect(afterScrollTop).toBeGreaterThan(500);
  });

  test("preserves cursor visibility and position when clicking the UI mode switch button", async ({
    page,
  }) => {
    await openAppWithLongDoc(page);
    const editor = page.locator(".cm-editor");
    await expect(editor).toHaveAttribute("data-editor-mode", "wysiwyg");

    // Scroll and position cursor on line 75
    await page.evaluate(() => {
      window.__MD_EDITOR_E2E__?.scrollToLine(75, { select: true, focus: true });
    });
    await page.waitForTimeout(100);

    const beforeGeometry = await getCursorGeometry(page);
    expect(beforeGeometry).not.toBeNull();

    // Click the mode switch button in the UI
    const modeBtn = page.getByRole("button", { name: "切换到源码" });
    await modeBtn.click();
    await expect(editor).toHaveAttribute("data-editor-mode", "source");

    // Refocus the editor to inspect the cursor
    await page.locator(".cm-content").focus();
    await page.waitForTimeout(100);

    const afterGeometry = await getCursorGeometry(page);
    expect(afterGeometry).not.toBeNull();
    // Cursor must remain in visible viewport
    expect(afterGeometry!.cursorBottom).toBeGreaterThanOrEqual(afterGeometry!.scrollerTop);
    expect(afterGeometry!.cursorTop).toBeLessThanOrEqual(afterGeometry!.scrollerBottom);

    expect(
      Math.abs(afterGeometry!.relativeOffset - beforeGeometry!.relativeOffset),
    ).toBeLessThanOrEqual(2);
  });
});
