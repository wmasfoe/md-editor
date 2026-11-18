import { expect, test } from "@playwright/test";

test("the desktop Select All action highlights a newly opened WYSIWYG document", async ({
  page,
}) => {
  const markdown = "# Heading\n\n**First** paragraph.\n\nLast paragraph.";
  const originalPath = "/fixtures/select-all.md";
  // The native Edit menu only exists on macOS. Load the corresponding CM6 keymap in CI.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
  });
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();

  const open = async (source: string, filePath: string) => {
    await page.evaluate(
      ([text, openedPath]) =>
        window.__MD_EDITOR_E2E__?.replaceDocument(text, openedPath, "wysiwyg"),
      [source, filePath] as const,
    );
    await expect.poll(readEditor).toMatchObject({
      markdown: source,
      selectionAnchor: 0,
      selectionHead: 0,
    });
    await page.locator(".cm-content").focus();
  };
  const readEditor = () => page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer);
  const highlight = page.locator(".cm-selectionLayer .cm-selectionBackground").first();
  const selectAll = async () => {
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.selectAllFromMenu());
    await expect.poll(readEditor).toMatchObject({
      markdown,
      selectionAnchor: 0,
      selectionHead: markdown.length,
    });
    await expect(highlight).toBeVisible();
  };

  await open(markdown, originalPath);
  await expect(highlight).toHaveCount(0);
  await selectAll();

  await page.keyboard.press("Backspace");
  await expect.poll(readEditor).toMatchObject({ markdown: "" });
  await expect(highlight).toHaveCount(0);

  // Undo restores the previous range. Collapse it so the next menu action must draw it again.
  await page.keyboard.press("Meta+z");
  await expect.poll(readEditor).toMatchObject({ markdown });
  await page.keyboard.press("ArrowLeft");
  await expect(highlight).toHaveCount(0);
  await selectAll();

  await open("Another document", "/fixtures/other.md");
  await open(markdown, originalPath);
  await expect(highlight).toHaveCount(0);
  await selectAll();
});
