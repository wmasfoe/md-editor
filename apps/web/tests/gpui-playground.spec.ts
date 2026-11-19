import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("GPUI browser playground imports, edits, and downloads Markdown", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(process.env.VITE_BASE_PATH || "/playground/");
  await expect(page.getByText("Inkpoint Web Playground")).toBeVisible();
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  expect(canvasBounds!.y).toBeGreaterThanOrEqual(0);
  expect(canvasBounds!.y).toBeLessThan(await page.evaluate(() => innerHeight));
  await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeVisible();

  const imported = "# 中文标题\n\n带有中文的 WebAssembly 文档。\n";
  await page.locator("#markdown-file").setInputFiles({
    name: "中文.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(imported, "utf8"),
  });
  await expect(page.locator("#playground-status")).toHaveText("Opened 中文.md");

  await canvas.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n键盘编辑");
  await expect(page.locator("#playground-status")).toHaveText("Unsaved changes");

  const changedDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const changedDownload = await changedDownloadPromise;
  const changed = await readFile((await changedDownload.path())!, "utf8");
  expect(changed).toContain(imported);
  expect(changed).toContain("键盘编辑");

  await canvas.click();
  const undoShortcut = (await page.evaluate(() => navigator.platform)).startsWith("Mac")
    ? "Meta+z"
    : "Control+z";
  await page.keyboard.press(undoShortcut);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  const saved = await readFile((await download.path())!, "utf8");
  expect(saved).toContain(imported);
  expect(saved).not.toContain("键盘编辑");
  expect(pageErrors).toEqual([]);
});
