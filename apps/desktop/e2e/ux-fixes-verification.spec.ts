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

  // ==========================================
  // Test 5: GFM Alert mode switch from source to wysiwyg
  // ==========================================
  test("reproduces alert mode switch error when switching from source to wysiwyg", async ({
    page,
  }) => {
    await openApp(page);
    const modeButton = page.getByRole("button", { name: "切换到源码" });
    await modeButton.click();
    await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "source");

    const content = page.locator(".cm-content");
    const sourceModeButton = page.getByRole("button", { name: "切换到所见即所得" });

    const variations = ["> [!NOTE]\n>\n> 123", "> [!NOTE]\n\n> 123", "> [!NOTE]\n> \n> 123"];

    for (const text of variations) {
      // Test caret at beginning, middle, and end
      const testPositions = [0, 5, text.length];

      for (const pos of testPositions) {
        // Reset to source mode
        await content.click();
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Backspace");

        await page.evaluate(async (t) => {
          await navigator.clipboard.writeText(t);
        }, text);
        await page.keyboard.press("Meta+v");
        await page.waitForTimeout(50);

        // Set caret to pos
        await setCaret(page, pos);
        await page.waitForTimeout(50);

        await sourceModeButton.click();
        await page.waitForTimeout(100);

        const toast = page.locator("[role='alert']");
        if ((await toast.count()) > 0) {
          const toastTexts = await toast.allTextContents();
          expect(toastTexts.join(" ")).not.toContain("Renderer mode change failed");
        }

        await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "wysiwyg");

        // Switch back to source for next test
        await modeButton.click();
        await page.waitForTimeout(100);
      }
    }
  });

  // ==========================================
  // Test 6: Blockquote marker (>) invisibility in WYSIWYG mode
  // ==========================================
  test("Blockquote does not render small > marker in wysiwyg mode", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "wysiwyg");

    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");

    const quoteMarkdown = "> 这是一个引用段落\n>\n> 这是第二行引用";
    await setMarkdown(page, quoteMarkdown);
    await page.waitForTimeout(200);

    // 1. 验证行级引用块装饰存在
    const quoteLines = page.locator(".cm-md-block-line--quote");
    await expect(quoteLines).toHaveCount(3);

    // 2. 验证小 > 或 › 标记完全不可见（数量为 0）
    const quoteMarkers = page.locator(".cm-md-block-marker--quote");
    await expect(quoteMarkers).toHaveCount(0);

    // 3. 验证行内文本直接展示正文，不包含 > 或 › 字符
    const firstLineText = await quoteLines.first().innerText();
    expect(firstLineText).toBe("这是一个引用段落");
    expect(firstLineText).not.toContain(">");
    expect(firstLineText).not.toContain("›");
  });

  // ==========================================
  // Test 7: Cursor ArrowUp from below blockquote enters last content line
  // ==========================================
  test("ArrowUp from empty line below blockquote moves into last content line", async ({
    page,
  }) => {
    await openApp(page);

    const doc = "> Quote line 1\n> Quote line 2\n";
    await setMarkdown(page, doc);
    await page.waitForTimeout(200);

    // Place caret at empty line below quote (e.g. after double enter to exit quote)
    await setCaret(page, doc.length);

    // Press ArrowUp
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);

    const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    const pos = diag?.renderer?.selectionAnchor ?? -1;
    const md = diag?.renderer?.markdown ?? "";

    // 验证光标进入了 "Quote line 2" 所在行（第 2 行），而不是越过引用块跑到上方
    const line2Start = md.indexOf("> Quote line 2");
    const line2End = md.indexOf("\n", line2Start);
    expect(pos).toBeGreaterThanOrEqual(line2Start);
    expect(pos).toBeLessThanOrEqual(line2End);
  });

  // ==========================================
  // Test 8: Cursor ArrowUp from below GFM alert enters last content line
  // ==========================================
  test("ArrowUp from empty line below GFM alert enters last content line", async ({ page }) => {
    await openApp(page);

    const doc = "# 标题\n\n> [!NOTE]\n>\n> 123\n";
    await setMarkdown(page, doc);
    await page.waitForTimeout(200);

    // Place caret at empty line below alert
    await setCaret(page, doc.length);

    // Press ArrowUp
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);

    const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    const pos = diag?.renderer?.selectionAnchor ?? -1;
    const md = diag?.renderer?.markdown ?? "";

    // 验证光标准确进入了 Alert 内容区的最后一行 "> 123"
    const contentLineStart = md.indexOf("> 123");
    const contentLineEnd = md.indexOf("\n", contentLineStart);
    expect(pos).toBeGreaterThanOrEqual(contentLineStart);
    expect(pos).toBeLessThanOrEqual(contentLineEnd);
  });

  // ==========================================
  // Test 9: GFM Alert Header never reveals source code
  // ==========================================
  test("GFM Alert Header never reveals raw [!NOTE] source code", async ({ page }) => {
    await openApp(page);

    const doc = "> [!NOTE]\n> 123";
    await setMarkdown(page, doc);
    await page.waitForTimeout(200);

    // 1. 验证 Header 渲染为卡片头部
    const headerWidget = page.locator(".cm-md-directive__header-content");
    await expect(headerWidget).toBeVisible();

    // 2. 点击 Header 区域
    await headerWidget.click();
    await page.waitForTimeout(100);

    // 3. 验证 Header 依然保持卡片渲染，绝不展开回显 [!NOTE] 原文
    await expect(headerWidget).toBeVisible();
    const contentText = await page.locator(".cm-content").innerText();
    expect(contentText).not.toContain("[!NOTE]");

    // 4. 验证光标位于内容行
    const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics());
    const pos = diag?.renderer?.selectionAnchor ?? -1;
    expect(pos).toBeGreaterThanOrEqual(doc.indexOf("> 123"));
  });
});
