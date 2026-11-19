import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // The native Edit menu only exists on macOS. Load the corresponding CM6 keymap in CI.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
  });
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
});

test("the desktop Select All action highlights a newly opened WYSIWYG document", async ({
  page,
}) => {
  const markdown = "# Heading\n\n**First** paragraph.\n\nLast paragraph.";
  const originalPath = "/fixtures/select-all.md";

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

test("the desktop Select All action highlights YAML frontmatter and the Markdown body", async ({
  page,
}) => {
  const markdown = `---
title: 最近的笔记
pubDatetime: 2026-11-05T00:00:00+00:00
tags:
  - 日常
  - 随笔
draft: true
description: "这是一段带标点的中文摘要，用来验证元数据和正文的选区。"
---

正文
正文2
`;
  await page.evaluate((source) => {
    window.__MD_EDITOR_E2E__?.replaceDocument(
      source,
      "/fixtures/frontmatter-select-all.md",
      "wysiwyg",
    );
  }, markdown);
  await expect(page.locator(".cm-md-frontmatter-line--body").first()).toBeVisible();
  await page.getByText("正文2", { exact: true }).click();
  await page.evaluate(() => window.__MD_EDITOR_E2E__?.selectAllFromMenu());

  const readEditor = () => page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer);
  await expect.poll(readEditor).toMatchObject({
    markdown,
    selectionAnchor: 0,
    selectionHead: markdown.length,
  });

  const selectedLines = page.locator(".cm-line").filter({ hasText: /^(title:.*|正文2?)$/ });
  await expect(selectedLines).toHaveCount(3);
  await expect
    .poll(() =>
      selectedLines.evaluateAll((lines) => {
        const contentRect = lines[0]?.parentElement?.getBoundingClientRect();
        if (!contentRect) return false;
        const markers = Array.from(
          document.querySelectorAll(".cm-selectionLayer .cm-selectionBackground"),
          (element) => element.getBoundingClientRect(),
        );
        // A rectangle with invalid coordinates can still have nonzero dimensions.
        return {
          insideContent: markers.every(
            (marker) =>
              marker.top >= contentRect.top - 1 && marker.bottom <= contentRect.bottom + 1,
          ),
          textHighlighted: lines.map((line) => {
            const text = document.createRange();
            text.selectNodeContents(line);
            const rect = text.getBoundingClientRect();
            const x = (rect.left + rect.right) / 2;
            const y = (rect.top + rect.bottom) / 2;
            return markers.some(
              (marker) =>
                marker.left <= x && x < marker.right && marker.top <= y && y < marker.bottom,
            );
          }),
        };
      }),
    )
    .toEqual({ insideContent: true, textHighlighted: [true, true, true] });

  await page.keyboard.press("Backspace");
  await expect.poll(readEditor).toMatchObject({ markdown: "" });
  await page.keyboard.press("Meta+z");
  await expect.poll(readEditor).toMatchObject({ markdown });
});
