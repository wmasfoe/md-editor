import { expect, test, type Page } from "@playwright/test";

const CALLOUT_MARKDOWN = [
  '<Callout type="info" title="提示">',
  "body content",
  "</Callout>",
  "",
].join("\n");

const UNKNOWN_MARKDOWN = ["<Unknown>raw</Unknown>", ""].join("\n");

const SCRIPT_SMUGGLE_MARKDOWN = ["<Callout>body</Callout><script>alert(1)</script>", ""].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
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

test.describe("CodeMirror M4 MDX projection", () => {
  test("M5-E01: renders a registered Callout component as a widget", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, CALLOUT_MARKDOWN);

    const widget = page.locator(".cm-md-mdx-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget.locator("strong")).toHaveText("Callout");
    // 属性展示(协议过滤后仅安全属性)
    await expect(widget.locator("dd")).toHaveText(["info", "提示"]);
    // children 以纯文本预览,不解析为 HTML
    await expect(widget.locator("pre")).toContainText("body content");
    // 源码保留:切换 source 模式可见原始 MDX
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    await expect(page.locator(".cm-content")).toContainText("<Callout");
  });

  test("M5-E02: unknown component shows a placeholder without executing", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, UNKNOWN_MARKDOWN);

    const widget = page.locator(".cm-md-mdx-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget.locator("strong")).toHaveText("Unknown");
    await expect(widget.locator(".cm-md-mdx-widget__badge")).toHaveText("未注册组件");
  });

  test("M5-E03: atomically selects and deletes the component block, undo restores", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, CALLOUT_MARKDOWN);

    // 点击组件块触发原子选中(与 HTML/table widget 同语义,跨平台可靠)
    const widget = page.locator(".cm-md-mdx-widget");
    await widget.click();
    await expect(widget).toHaveAttribute("aria-selected", "true");
    // 慢环境(并行 worker/CI)下等待 selection 完全生效再删除,避免 Backspace 落空
    await page.waitForTimeout(100);
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .not.toContain("Callout");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toContain("<Callout");
  });

  test("M5-E04: script smuggling does not produce a component widget", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, SCRIPT_SMUGGLE_MARKDOWN);

    // 只有 Callout 是组件;script 小写标签走 HTML 路径(不产生 mdx widget)
    const widgets = page.locator(".cm-md-mdx-widget");
    await expect(widgets).toHaveCount(1);
    await expect(widgets.first().locator("strong")).toHaveText("Callout");
  });

  test("M5-E05: editing children in source mode round-trips back to the widget", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, CALLOUT_MARKDOWN);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    const content = page.locator(".cm-content");
    await content.click();
    // Control+A 在编辑器内全选(Playwright 在 macOS 自动映射为 Cmd+A,跨平台可靠)
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText('<Callout type="info">\n新内容\n</Callout>');
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));

    await expect(page.locator(".cm-md-mdx-widget")).toHaveCount(1);
    await expect(page.locator(".cm-md-mdx-widget pre")).toContainText("新内容");
  });
});
