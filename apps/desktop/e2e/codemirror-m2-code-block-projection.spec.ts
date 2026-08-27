import { expect, test, type Page } from "@playwright/test";

const CLOSED = [
  "Before",
  "",
  "```ts meta=1",
  "const first = 1;",
  "const wrapped = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
  "```",
  "",
  "    indented one",
  "    indented two",
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

test.describe("CodeMirror M2 code-block projection", () => {
  test("G004 hides and protects source chrome with block-local line numbers", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 520 });
    await openHarness(page);
    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, CLOSED);

    const initial = await diagnostics(page);
    expect(initial.renderer).toMatchObject({
      markdown: CLOSED,
      codeBlockLineNumbers: false,
      wysiwygProjection: { mode: "wysiwyg" },
    });
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(2);
    await expect(page.locator(".cm-md-code-toolbar__language")).toHaveCount(1);
    await expect(page.locator(".cm-md-code-toolbar__language")).toBeEnabled();
    await expect(page.locator(".cm-md-code-structural-line-hidden")).toHaveCount(2);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(0);
    await expect(page.locator(".cm-gutters, .cm-lineNumbers")).toHaveCount(0);

    const projectionGeometry = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>(".cm-md-code-toolbar");
      const firstBodyLine = document.querySelector<HTMLElement>(".cm-md-code-line");
      const structuralLines = [
        ...document.querySelectorAll<HTMLElement>(".cm-md-code-structural-line-hidden"),
      ];
      if (!toolbar || !firstBodyLine) {
        throw new Error("Code-block projection geometry is unavailable.");
      }
      return {
        structuralHeights: structuralLines.map((line) => line.getBoundingClientRect().height),
        toolbarBottom: toolbar.getBoundingClientRect().bottom,
        firstBodyTop: firstBodyLine.getBoundingClientRect().top,
      };
    });
    expect(projectionGeometry.structuralHeights).toEqual([0, 0]);
    expect(projectionGeometry.toolbarBottom).toBeLessThanOrEqual(
      projectionGeometry.firstBodyTop + 1,
    );

    const codeLine = page.locator(".cm-md-code-line").filter({ hasText: "const first" });
    await codeLine.click();
    await expect(page.locator(".cm-md-code-toolbar--active")).toHaveCount(1);
    await expect(page.locator(".cm-md-code-line--active")).toHaveCount(2);

    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.setCodeBlockLineNumbers(true);
    });
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.codeBlockLineNumbers)
      .toBe(true);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(4);
    await expect(page.locator('[data-md-code-line-number="1"]')).toHaveCount(2);
    await expect(page.locator('[data-md-code-line-number="2"]')).toHaveCount(2);
    await expect(page.locator(".cm-gutters, .cm-lineNumbers")).toHaveCount(0);

    const wrapped = page.locator(".cm-md-code-line").filter({ hasText: "const wrapped" });
    const geometry = await wrapped.evaluate((line) => ({
      height: line.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
      number: line.getAttribute("data-md-code-line-number"),
    }));
    expect(geometry.height).toBeGreaterThan(geometry.lineHeight);
    expect(geometry.number).toBe("2");

    const sourceResult = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"),
    );
    expect(sourceResult).toMatchObject({ ok: true });
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(0);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("```ts meta=1");
    const source = await diagnostics(page);
    expect(source.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      markdown: CLOSED,
      codeBlockLineNumbers: true,
    });

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(2);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(4);

    const unclosed = "```ts\nconst pending = true;\n";
    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, unclosed);
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(0);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("```ts");

    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, CLOSED);
    await expect(page.locator(".cm-md-code-line-numbered")).toHaveCount(4);
    const final = await diagnostics(page);
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      codeBlockLineNumbers: true,
    });
    expect(final.renderer?.wysiwyg.widgetLifecycleCounts["code-block"].create).toBeGreaterThan(0);
  });
});
