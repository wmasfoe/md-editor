import { expect, test, type Page } from "@playwright/test";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()))
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

async function rendererMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown);
}

test.describe("CodeMirror M2 native mixed-language loading", () => {
  test("M2C-E12: the latest exact info token owns the eventual parser and source", async ({
    page,
  }) => {
    await openHarness(page);
    const typescript = ["```ts", "interface Previous { value: string }", "```", ""].join("\n");
    const python = ["```python", "def current(value):", "    return value is True", "```", ""].join(
      "\n",
    );

    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, typescript);
    const editResult = await page.evaluate((markdown) => {
      return window.__CODEMIRROR_EDITOR_E2E__?.applyExternalEdit(markdown);
    }, python);
    expect(editResult).toMatchObject({ status: "applied" });

    await expect.poll(() => rendererMarkdown(page)).toBe(python);
    await expect(page.locator(".tok-keyword").filter({ hasText: "def" })).toHaveCount(1);
    await expect(page.locator(".tok-keyword").filter({ hasText: "return" })).toHaveCount(1);
    await expect(page.locator(".tok-bool").filter({ hasText: "True" })).toHaveCount(1);
    await expect(page.locator(".cm-editor")).toHaveCount(1);

    const unknown = ["```typescript-extra", "const value = 1;", "```", ""].join("\n");
    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, unknown);

    await expect.poll(() => rendererMarkdown(page)).toBe(unknown);
    const unknownBody = page.locator(".cm-line").filter({ hasText: "const value" });
    await expect(unknownBody).toHaveCount(1);
    await expect(unknownBody.locator(".tok-keyword")).toHaveCount(0);
  });
});
