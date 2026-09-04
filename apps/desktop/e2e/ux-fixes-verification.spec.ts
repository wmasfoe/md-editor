import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
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

async function setCaret(page: Page, from: number, to = from): Promise<void> {
  await page.evaluate(([f, t]) => window.__MD_EDITOR_E2E__?.setSelection(f, t), [from, to]);
}

test.describe("UX Fixes Verification", () => {
  test.beforeEach(async ({ page: _page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:4173",
    });
  });

  // ==========================================
  // Test 1: Double Enter on empty list item exits list
  // ==========================================
  test("List Item double Enter exits list", async ({ page }) => {
    await openApp(page);
    const docMd = "- Item 1\n";
    await setMarkdown(page, docMd);

    // Place caret at end of '- Item 1'
    await setCaret(page, 8);
    // Press Enter to generate '- '
    await page.keyboard.press("Enter");
    let md = await getMarkdown(page);
    expect(md).toBe("- Item 1\n- \n");

    // Press Enter on the empty list item '- '
    await page.keyboard.press("Enter");
    md = await getMarkdown(page);
    console.log("[Test 1 markdown after 2nd Enter on empty list item]:\n" + JSON.stringify(md));
    // The empty list marker must be cleared, leaving an empty paragraph line!
    expect(md).toBe("- Item 1\n\n");
  });

  // ==========================================
  // Test 2: Double Enter on empty blockquote exits quote
  // ==========================================
  test("Blockquote double Enter exits quote", async ({ page }) => {
    await openApp(page);
    const docMd = "> Quote line 1\n";
    await setMarkdown(page, docMd);

    // Place caret at end of quote
    await setCaret(page, 14);
    // Press Enter to continue quote '> '
    await page.keyboard.press("Enter");
    let md = await getMarkdown(page);
    expect(md).toBe("> Quote line 1\n> \n");

    // Press Enter on the empty quote line
    await page.keyboard.press("Enter");
    md = await getMarkdown(page);
    console.log("[Test 2 markdown after 2nd Enter on empty quote]:\n" + JSON.stringify(md));
    // The quote marker must be cleared, leaving a blank line!
    expect(md).toBe("> Quote line 1\n\n");
  });

  // ==========================================
  // Test 3: Table Tab on bottom-right cell auto-appends row
  // ==========================================
  test("Table Tab on last cell auto-appends row and focuses first cell", async ({ page }) => {
    await openApp(page);
    const tableMd = ["| Col 1 | Col 2 |", "| :--- | :--- |", "| Val A | Val B |", ""].join("\n");
    await setMarkdown(page, tableMd);

    // Click on bottom-right cell (row 0, col 1)
    const lastCell = page.locator('tbody td[data-row-index="0"][data-col-index="1"]');
    await lastCell.click();

    // Press Tab
    await page.keyboard.press("Tab");

    // Wait for row count to become 2 body rows
    await expect
      .poll(async () => {
        const rows = page.locator("tbody tr");
        return rows.count();
      })
      .toBe(2);

    const md = await getMarkdown(page);
    console.log("[Test 3 markdown after Tab on last cell]:\n" + JSON.stringify(md));
    expect(md).toContain("| Val A | Val B |");
    expect(md).toMatch(/\|\s+\|\s+\|/); // Newly inserted empty row
  });

  // ==========================================
  // Test 4: Smart Pairs No Auto-close & Selection Wrapping
  // ==========================================
  test("Smart pairs does not auto-close on empty cursor and wraps non-empty selection", async ({
    page,
  }) => {
    await openApp(page);
    const content = page.locator(".cm-content");
    await content.click();

    // Type '(' -> does NOT auto close, enters single '('
    await page.keyboard.type("(");
    let md = await getMarkdown(page);
    expect(md.trim()).toBe("(");

    // Type '`' -> enters single '`' (allows typing ``` for code blocks)
    await page.keyboard.type("`");
    md = await getMarkdown(page);
    expect(md.trim()).toBe("(`");

    // Clear and test selection wrapping: select 'hello' and type '(' -> '(hello)'
    await setMarkdown(page, "hello");
    await setCaret(page, 0, 5);
    await page.keyboard.type("(");
    md = await getMarkdown(page);
    expect(md.trim()).toBe("(hello)");
  });
});
