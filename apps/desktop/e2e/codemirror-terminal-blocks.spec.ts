import { expect, test } from "@playwright/test";
import { loadDoc, openFullApp, readDoc, setCaret } from "./editor-e2e-helpers";

const diagram = "```mermaid\ngraph TD; A-->B\n```";
for (const direction of ["down", "up"] as const) {
  test(`Mermaid source is entered from the ${direction === "down" ? "top" : "bottom"} edge`, async ({
    page,
  }) => {
    const source = "Before\n\n" + diagram + "\n\nAfter";
    const start = source.indexOf("```mermaid");
    const end = start + diagram.length;
    await openFullApp(page);
    await loadDoc(page, source);
    await expect(page.locator(".cm-md-mermaid-block")).toHaveCount(1);
    await setCaret(page, direction === "down" ? start - 1 : end + 1);
    await page.keyboard.press(direction === "down" ? "ArrowDown" : "ArrowUp");
    await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer?.selectionHead),
      )
      .toBe(direction === "down" ? start + 1 : end - 1);
    expect(await readDoc(page)).toBe(source);
  });
}

for (const [name, source] of [
  ["mermaid", "Before\n\n" + diagram],
  [
    "quoted mermaid",
    "Before\n\n" +
      diagram
        .split("\n")
        .map((line) => "> " + line)
        .join("\n"),
  ],
  ["list mermaid", "Before\n\n- item\n\n  " + diagram.replaceAll("\n", "\n  ")],
  ["quote", "> quoted text"],
  ["list", "- item"],
]) {
  test(`terminal ${name}: click, type outside the container, undo`, async ({ page }) => {
    await openFullApp(page);
    await loadDoc(page, source);
    if (name.includes("mermaid")) await expect(page.locator(".cm-md-mermaid-block")).toHaveCount(1);
    const line = page.locator(".cm-virtual-trailing-line");
    await expect(line).toHaveCount(1);
    expect(await readDoc(page)).toBe(source);
    await line.click();
    await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);
    await page.keyboard.type("Tail");
    await expect.poll(() => readDoc(page)).toBe(source + "\n\nTail");
    await expect(page.locator(".cm-virtual-trailing-line")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readDoc(page)).toBe(source);
  });
}

test("terminal Mermaid source folds when ArrowDown enters the virtual line", async ({ page }) => {
  const source = "Before\n\n" + diagram;
  await openFullApp(page);
  await loadDoc(page, source);
  await page.locator(".cm-md-mermaid-container").click();
  await page.locator(".cm-md-media-viewer__edit").click();
  await setCaret(page, source.length);
  await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-virtual-trailing-line--active")).toHaveCount(1);
  await expect(page.locator(".cm-md-mermaid-block")).toHaveCount(1);
  expect(await readDoc(page)).toBe(source);
});
