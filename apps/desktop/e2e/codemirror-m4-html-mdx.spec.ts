import { expect, test, type Page } from "@playwright/test";

const SAFE_HTML_MARKDOWN = [
  "Before",
  "",
  '<div class="hero"><h2>Title</h2><p>Body <strong>bold</strong></p></div>',
  "",
  '<Component value="raw" />',
  "",
  "After",
  "",
].join("\n");

const ATTACK_HTML_MARKDOWN = [
  "Before",
  "",
  '<div><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">safe</a></div>',
  "",
  "After",
  "",
].join("\n");

const UNSUPPORTED_HTML_MARKDOWN = [
  "Before",
  "",
  "<table><tr><td>A</td></tr></table>",
  "",
  "After",
  "",
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

test.describe("CodeMirror M4 HTML projection", () => {
  test("M4-E01: sanitizes and renders a block while preserving HTMLTag source", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, SAFE_HTML_MARKDOWN);

    const widget = page.locator(".cm-md-html-block-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget).toHaveAttribute("role", "group");
    await expect(widget).toHaveAttribute("aria-label", "HTML block");
    await expect(widget).toContainText("Title");
    await expect(widget).toContainText("Body bold");
    await expect(widget.locator("[class='hero']")).toHaveCount(0);
    await expect(page.locator(".cm-content")).not.toContainText('<div class="hero"><h2>Title</h2>');
    await expect(page.locator(".cm-content")).toContainText('<Component value="raw" />');
  });

  test("M4-E02: removes dangerous nodes and attributes in the real DOM", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, ATTACK_HTML_MARKDOWN);

    const widget = page.locator(".cm-md-html-block-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget.locator("script, iframe, [onerror], [style]")).toHaveCount(0);
    await expect(widget.locator("[href*='javascript']")).toHaveCount(0);
    await expect(widget).toContainText("safe");
  });

  test("M4-E03: selects and deletes the whole HTML block with undo", async ({ page }) => {
    await openHarness(page);
    const markdown = ["Before", "", "<div>Safe</div>", "", "After", ""].join("\n");
    await replaceDocument(page, markdown);

    const widget = page.locator(".cm-md-html-block-widget");
    await widget.click();
    await expect(widget).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Backspace");
    const withoutHtml = ["Before", "", "", "", "After", ""].join("\n");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(withoutHtml);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
    await expect(page.locator(".cm-md-html-block-widget")).toHaveCount(1);
  });

  test("M4-E04: turns unsupported table structure into a source-mode fallback", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, UNSUPPORTED_HTML_MARKDOWN);

    const widget = page.locator(".cm-md-html-block-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget.locator(".cm-md-html-block-widget__placeholder")).toContainText(
      "Unsupported or unsafe HTML block",
    );

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    await expect(page.locator(".cm-content")).toContainText("<table><tr><td>A</td></tr></table>");
  });
});
