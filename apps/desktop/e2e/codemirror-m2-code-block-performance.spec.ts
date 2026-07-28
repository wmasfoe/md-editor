import { expect, test, type Page } from "@playwright/test";
import { getM2CodeBlockPerformanceFixture } from "@md-editor/renderer-codemirror/testing";

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

async function waitForParseQuiescence(page: Page): Promise<void> {
  let previousKey = "";
  let stableSampleCount = 0;
  await expect
    .poll(
      async () => {
        const snapshot = await diagnostics(page);
        const key = [
          snapshot.renderer?.wysiwyg.fullIndexBuildCount,
          snapshot.renderer?.wysiwyg.parseCoverageRefreshCount,
          snapshot.renderer?.wysiwygProjection.layoutDecorationCount,
        ].join(":");
        stableSampleCount = key === previousKey ? stableSampleCount + 1 : 0;
        previousKey = key;
        return stableSampleCount;
      },
      { intervals: [200], timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(4);
}

test.describe("CodeMirror M2 code-block performance", () => {
  test("M2C-E15 keeps the fixed 50x200 plus 20,000-line fixture incremental", async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = getM2CodeBlockPerformanceFixture();
    await openHarness(page);
    const initial = await diagnostics(page);

    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, fixture.markdown);
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(1);
    await waitForParseQuiescence(page);

    const beforeEdit = await diagnostics(page);
    expect(beforeEdit.renderer?.markdown).toHaveLength(fixture.markdown.length);
    expect(beforeEdit.renderer?.markdown).toContain("huge-line-19999");
    expect(beforeEdit.renderer?.wysiwygProjection.layoutDecorationCount).toBeGreaterThan(0);
    const firstLine = page.locator(".cm-md-code-line").filter({ hasText: "regular-000-line-000" });
    await firstLine.click();
    await page.keyboard.press("End");
    await page.keyboard.type("X");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toContain("regular-000-line-000X");

    const afterEdit = await diagnostics(page);
    expect(afterEdit.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: beforeEdit.renderer?.stateEpochId,
    });
    expect(afterEdit.cmEditorCount).toBe(1);
    const parseRefreshDelta =
      (afterEdit.renderer?.wysiwyg.parseCoverageRefreshCount ?? 0) -
      (beforeEdit.renderer?.wysiwyg.parseCoverageRefreshCount ?? 0);
    expect(
      (afterEdit.renderer?.wysiwyg.fullIndexBuildCount ?? 0) -
        (beforeEdit.renderer?.wysiwyg.fullIndexBuildCount ?? 0) -
        parseRefreshDelta,
    ).toBe(0);
    expect(
      (afterEdit.renderer?.wysiwyg.fullProjectionBuildCount ?? 0) -
        (beforeEdit.renderer?.wysiwyg.fullProjectionBuildCount ?? 0) -
        parseRefreshDelta,
    ).toBe(0);
    expect(afterEdit.renderer?.wysiwyg.dirtyBlockRebuildCount).toBe(
      (beforeEdit.renderer?.wysiwyg.dirtyBlockRebuildCount ?? 0) + 1,
    );
    expect(afterEdit.renderer?.wysiwyg.dirtyCodeBlockRebuildCount).toBe(
      (beforeEdit.renderer?.wysiwyg.dirtyCodeBlockRebuildCount ?? 0) + 1,
    );
    if (parseRefreshDelta === 0) {
      expect(afterEdit.renderer?.wysiwygProjection.layoutDecorationCount).toBe(
        beforeEdit.renderer?.wysiwygProjection.layoutDecorationCount,
      );
    } else {
      expect(afterEdit.renderer?.wysiwygProjection.layoutDecorationCount).toBeGreaterThanOrEqual(
        beforeEdit.renderer?.wysiwygProjection.layoutDecorationCount ?? 0,
      );
    }
  });
});
