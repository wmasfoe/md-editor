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
});
