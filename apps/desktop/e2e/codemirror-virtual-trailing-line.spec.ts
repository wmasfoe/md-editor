import { expect, test, type Page } from "@playwright/test";

const USER_HTML_SNIPPET = [
  "但是，我们",
  "",
  "",
  "<head>",
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  "    <title>Inkpoint</title>",
  "  </head>",
].join("\n");

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

async function replaceDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((nextMarkdown) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(nextMarkdown, "wysiwyg");
  }, markdown);
  await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
}

test.describe("Virtual Trailing Line E2E", () => {
  test("VTL-01: renders virtual line widget at bottom when HTML block ends document without blank line", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);

    // 验证 HTML 渲染块存在
    const widget = page.locator(".cm-md-html-block-widget");
    await expect(widget).toHaveCount(1);

    // 验证文末挂载了虚拟空行
    const virtualLine = page.locator(".cm-virtual-trailing-line");
    await expect(virtualLine).toHaveCount(1);
    await expect(virtualLine).toHaveAttribute("data-virtual-line", "true");

    // 验证底层文档完全零污染（0 字节增加）
    const diag = await diagnostics(page);
    expect(diag.renderer?.markdown).toBe(USER_HTML_SNIPPET);
  });

  test("VTL-02: does NOT render virtual line widget when document already has real trailing blank line", async ({
    page,
  }) => {
    await openHarness(page);
    // 末尾带双换行，形成真实的空行
    const withBlankLine = `${USER_HTML_SNIPPET}\n\n`;
    await replaceDocument(page, withBlankLine);

    const widget = page.locator(".cm-md-html-block-widget");
    await expect(widget).toHaveCount(1);

    // 文档末尾已有真实空行，绝不渲染虚拟空行
    const virtualLine = page.locator(".cm-virtual-trailing-line");
    await expect(virtualLine).toHaveCount(0);
  });

  test("VTL-03: pressing Enter on selected atom at EOF exits atom and creates new paragraph", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);

    const widget = page.locator(".cm-md-html-block-widget");
    await widget.click();
    await expect(widget).toHaveAttribute("aria-selected", "true");

    // 按回车键：退出原子组件并在下方开辟新行
    await page.keyboard.press("Enter");
    await expect(widget).toHaveAttribute("aria-selected", "false");

    // 输入正文
    await page.keyboard.type("这是新开的一行");

    // 验证 markdown 成功在 HTML 块下方以空行隔离追加新正文
    const expected = `${USER_HTML_SNIPPET}\n\n这是新开的一行`;
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(expected);
  });

  test("VTL-04: clicking virtual trailing line activates caret and typing materializes text", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);

    const virtualLine = page.locator(".cm-virtual-trailing-line");
    await expect(virtualLine).toHaveCount(1);

    // 单击虚拟空行
    await virtualLine.click();
    await expect(virtualLine).toHaveClass(/cm-virtual-trailing-line--active/);

    // 键入文本
    await page.keyboard.type("点击虚拟行后输入");

    // 验证即时物化为真实文档行
    const expected = `${USER_HTML_SNIPPET}\n\n点击虚拟行后输入`;
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(expected);
  });

  test("VTL-05: clicking the padding below the virtual line activates that line", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);

    const virtualLine = page.locator(".cm-virtual-trailing-line");
    await expect(virtualLine).toHaveCount(1);
    await clickBelow(page, virtualLine);

    await expect(virtualLine).toHaveClass(/cm-virtual-trailing-line--active/);
    const diag = await diagnostics(page);
    expect(diag.renderer?.markdown).toBe(USER_HTML_SNIPPET);
    expect(diag.renderer?.selectionHead).toBe(USER_HTML_SNIPPET.length);
  });

  test("VTL-06: clicking the padding below a real last line places the caret on that line", async ({
    page,
  }) => {
    await openHarness(page);
    const withBlankLine = `${USER_HTML_SNIPPET}\n\n`;
    await replaceDocument(page, withBlankLine);
    await expect(page.locator(".cm-virtual-trailing-line")).toHaveCount(0);

    const content = page.locator(".cm-content");
    await clickBelow(page, content.locator(".cm-line").last());

    const diag = await diagnostics(page);
    expect(diag.renderer?.markdown).toBe(withBlankLine);
    expect(diag.renderer?.selectionHead).toBe(withBlankLine.length);
  });

  test("VTL-07: arrow-down off a terminal table parks the caret on the virtual line, typing appends below the table", async ({
    page,
  }) => {
    await openHarness(page);
    const table = ["## 标题", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", ""].join("\n");
    await replaceDocument(page, table);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(0, 0));
    // 标题 → 空行 → 整表原子选中 → 离开整表：3 次 ArrowDown。
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowDown");

    await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);
    expect((await diagnostics(page)).renderer?.markdown).toBe(table);

    await page.keyboard.type("x");

    // 正文成为表格下方的独立段落，而不是被吞进表格的新行。
    await expect(page.locator(".cm-md-table-widget tbody tr")).toHaveCount(1);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(`${table}\nx`);
  });

  test("VTL-08: Enter, Backspace and Delete on the virtual line leave the file byte-identical", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);
    await page.locator(".cm-virtual-trailing-line").click();
    await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");

    expect((await diagnostics(page)).renderer?.markdown).toBe(USER_HTML_SNIPPET);
    await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);
  });

  test("VTL-09: Escape out of a comment at the end of the document does not trap the caret", async ({
    page,
  }) => {
    await openHarness(page);
    const doc = "Before\n\n<!-- note -->";
    await replaceDocument(page, doc);
    await page.evaluate(
      (pos) => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(pos, pos),
      doc.indexOf("note"),
    );

    await page.keyboard.press("Escape");
    // 注释不是需要虚拟空行的块：文末没有虚拟行，也就不该有被它吞掉的按键。
    await expect(page.locator(".cm-virtual-trailing-line")).toHaveCount(0);
    expect((await diagnostics(page)).renderer?.selectionHead).toBe(doc.length);

    await page.keyboard.press("Enter");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(`${doc}\n`);
  });

  test("VTL-10: pasting rich HTML onto the virtual line lands as Markdown below the block", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, USER_HTML_SNIPPET);
    await page.locator(".cm-virtual-trailing-line").click();
    await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);

    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "Title");
      data.setData("text/html", "<h2>Title</h2><ul><li>one</li><li>two</li></ul>");
      document
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });

    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown ?? "")
      .toContain(`${USER_HTML_SNIPPET}\n\n## Title`);
    expect((await diagnostics(page)).renderer?.markdown).not.toContain("<h2>");
  });
});

async function clickBelow(page: Page, anchor: ReturnType<Page["locator"]>): Promise<void> {
  await anchor.scrollIntoViewIfNeeded();
  const anchorBox = await anchor.boundingBox();
  const scrollerBox = await page.locator(".cm-scroller").boundingBox();
  if (!anchorBox || !scrollerBox) {
    throw new Error("editor geometry is unavailable");
  }
  const y = Math.min(anchorBox.y + anchorBox.height + 28, scrollerBox.y + scrollerBox.height - 6);
  if (y <= anchorBox.y + anchorBox.height) {
    throw new Error("no visible padding below the last line");
  }
  await page.mouse.click(anchorBox.x + Math.min(anchorBox.width / 2, 120), y);
}
