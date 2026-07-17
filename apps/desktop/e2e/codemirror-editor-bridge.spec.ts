import { expect, test, type Page } from "@playwright/test";

async function openHarness(page: Page, strictMode = false) {
  await page.goto(`/?surface=codemirror-editor${strictMode ? "&strict=true" : ""}`);
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

test.describe("CodeMirrorEditor React bridge", () => {
  test("preserves one native view across parent rerenders, modes, line numbers, and preview", async ({
    page,
  }) => {
    await openHarness(page);
    const initial = await diagnostics(page);
    expect(initial.rendererLifecycles).toHaveLength(1);
    expect(initial.subscriptions).toMatchObject({ snapshotActive: 1, transitionActive: 1 });

    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.press("Meta+ArrowDown");
    await page.keyboard.type(" local-edit");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await page.locator(".cm-scroller").evaluate((element) => {
      element.scrollTop = 480;
      element.dispatchEvent(new Event("scroll"));
    });

    const beforeRerender = await diagnostics(page);
    expect(beforeRerender.renderer?.undoDepth).toBeGreaterThan(0);
    expect(beforeRerender.renderer?.selectionAnchor).not.toBe(
      beforeRerender.renderer?.selectionHead,
    );
    expect(beforeRerender.renderer?.focused).toBe(true);
    expect(beforeRerender.renderer?.scrollTop).toBeGreaterThan(0);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.rerender());
    const afterRerender = await diagnostics(page);
    expect(afterRerender.renderer).toMatchObject({
      viewId: beforeRerender.renderer?.viewId,
      stateEpochId: beforeRerender.renderer?.stateEpochId,
      undoDepth: beforeRerender.renderer?.undoDepth,
      redoDepth: beforeRerender.renderer?.redoDepth,
      selectionAnchor: beforeRerender.renderer?.selectionAnchor,
      selectionHead: beforeRerender.renderer?.selectionHead,
      scrollTop: beforeRerender.renderer?.scrollTop,
      focused: true,
    });
    expect(afterRerender.rendererLifecycles).toHaveLength(1);

    const modeResult = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"),
    );
    expect(modeResult).toMatchObject({ ok: true });
    const afterMode = await diagnostics(page);
    expect(afterMode.renderer).toMatchObject({
      viewId: beforeRerender.renderer?.viewId,
      stateEpochId: beforeRerender.renderer?.stateEpochId,
      mode: "source",
      undoDepth: beforeRerender.renderer?.undoDepth,
      selectionAnchor: beforeRerender.renderer?.selectionAnchor,
      selectionHead: beforeRerender.renderer?.selectionHead,
      scrollTop: beforeRerender.renderer?.scrollTop,
      focused: true,
    });

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setLineNumbers(true));
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.lineNumbersEnabled)
      .toBe(true);
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setFontSize(19));
    await expect(page.locator(".code-mirror-editor-host")).toHaveCSS("font-size", "19px");
    const beforePreview = await diagnostics(page);
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setPreviewVisible(true));
    await expect(page.getByTestId("asset-preview")).toBeVisible();
    await expect(page.locator(".code-mirror-editor-host")).toHaveAttribute("aria-hidden", "true");
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setPreviewVisible(false));
    await expect(page.getByTestId("asset-preview")).toHaveCount(0);
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.scrollTop)
      .toBe(beforePreview.renderer?.scrollTop);

    const afterPreview = await diagnostics(page);
    expect(afterPreview.renderer).toMatchObject({
      viewId: beforePreview.renderer?.viewId,
      stateEpochId: beforePreview.renderer?.stateEpochId,
      undoDepth: beforePreview.renderer?.undoDepth,
      selectionAnchor: beforePreview.renderer?.selectionAnchor,
      selectionHead: beforePreview.renderer?.selectionHead,
      scrollTop: beforePreview.renderer?.scrollTop,
      focused: true,
      lineNumbersEnabled: true,
    });
    expect(afterPreview.renderer?.measureRequestCount).toBe(
      (beforePreview.renderer?.measureRequestCount ?? 0) + 1,
    );
    expect(afterPreview.syncErrorCount).toBe(0);
  });

  test("orchestrates external edits, document boundaries, and real unmounts", async ({ page }) => {
    await openHarness(page);
    const initial = await diagnostics(page);
    const externalResult = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__?.applyExternalEdit("external\ncontent\n"),
    );
    expect(externalResult).toMatchObject({ status: "applied" });
    const afterExternal = await diagnostics(page);
    expect(afterExternal.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      markdown: "external\ncontent\n",
      externalEditTransactionCount: 1,
      undoDepth: 1,
    });
    expect(afterExternal.subscriptions.transitionDeliveries).toBe(1);

    await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("replacement\n", "wysiwyg"),
    );
    const afterBoundary = await diagnostics(page);
    expect(afterBoundary.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      markdown: "replacement\n",
      selectionAnchor: 0,
      selectionHead: 0,
      scrollTop: 0,
      undoDepth: 0,
      redoDepth: 0,
      stateReplacementCount: 1,
    });
    expect(afterBoundary.renderer?.stateEpochId).not.toBe(initial.renderer?.stateEpochId);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.unmountEditor());
    await expect(page.locator(".cm-editor")).toHaveCount(0);
    const unmounted = await diagnostics(page);
    expect(unmounted.rendererAccess).toBe("unavailable");
    expect(unmounted.subscriptions).toMatchObject({ snapshotActive: 0, transitionActive: 0 });
    expect(unmounted.rendererLifecycles.at(-1)?.viewDestructionCount).toBe(1);

    const unavailableMode = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"),
    );
    expect(unavailableMode).toEqual({ status: "unavailable" });

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.mountEditor());
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    const remounted = await diagnostics(page);
    expect(remounted.rendererLifecycles).toHaveLength(2);
    expect(remounted.renderer?.viewId).not.toBe(initial.renderer?.viewId);
    expect(remounted.subscriptions).toMatchObject({ snapshotActive: 1, transitionActive: 1 });
  });

  test("destroys StrictMode probes and keeps the post-probe instance stable", async ({ page }) => {
    await openHarness(page, true);
    const initial = await diagnostics(page);
    expect(initial.rendererLifecycles.length).toBeGreaterThanOrEqual(2);
    expect(initial.rendererLifecycles.at(-2)?.viewDestructionCount).toBe(1);
    expect(initial.rendererLifecycles.at(-1)?.viewDestructionCount).toBe(0);
    expect(initial.subscriptions).toMatchObject({ snapshotActive: 1, transitionActive: 1 });

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.rerender());
    const afterRerender = await diagnostics(page);
    expect(afterRerender.renderer?.viewId).toBe(initial.renderer?.viewId);
    expect(afterRerender.rendererLifecycles).toHaveLength(initial.rendererLifecycles.length);
    expect(afterRerender.syncErrorCount).toBe(0);
  });
});
