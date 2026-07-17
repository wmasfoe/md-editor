import { expect, test, type Page } from "@playwright/test";

const SCROLL_FIXTURE = "/fixtures/s1-scroll.md";
const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO_KEY = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

test.describe("CodeMirror S1 desktop product surface", () => {
  test("E1-E3: preserves one view through modes/rerenders and emits no echo", async ({ page }) => {
    await openFixture(page, SCROLL_FIXTURE);
    const content = page.locator(".cm-content");
    const scroller = page.locator(".cm-scroller");
    const editor = page.locator(".cm-editor");
    const modeButton = page.getByRole("button", { name: "切换到源码" });
    await expect(modeButton).toHaveAttribute("aria-pressed", "false");
    await expect(editor).toHaveAttribute("data-editor-mode", "wysiwyg");
    const wysiwygFontFamily = await scroller.evaluate(
      (element) => getComputedStyle(element).fontFamily,
    );
    await modeButton.click();
    const sourceModeButton = page.getByRole("button", { name: "切换到所见即所得" });
    await expect(sourceModeButton).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toHaveAttribute("data-editor-mode", "source");
    const sourceFontFamily = await scroller.evaluate(
      (element) => getComputedStyle(element).fontFamily,
    );
    expect(sourceFontFamily).not.toBe(wysiwygFontFamily);
    await sourceModeButton.click();
    await expect(editor).toHaveAttribute("data-editor-mode", "wysiwyg");

    await content.click();
    await content.press("Control+End");
    await content.type("typed-e1");
    await content.press("Shift+ArrowLeft");
    await content.press("Shift+ArrowLeft");
    await scroller.evaluate((element) => {
      element.scrollTop = 500;
      element.dispatchEvent(new Event("scroll"));
    });

    const beforeModes = await diagnostics(page);
    expect(beforeModes.cmEditorCount).toBe(1);
    expect(beforeModes.proseMirrorCount).toBe(0);
    expect(beforeModes.platform).toMatchObject({ attachCount: 1, factoryCount: 1 });
    expect(beforeModes.renderer).toMatchObject({
      focused: true,
      selectionRangeCount: 1,
      undoDepth: 1,
    });
    expect(beforeModes.renderer!.selectionAnchor).not.toBe(beforeModes.renderer!.selectionHead);
    expect(beforeModes.renderer!.scrollTop).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__!.setMode("source");
      await window.__MD_EDITOR_E2E__!.setMode("wysiwyg");
      await window.__MD_EDITOR_E2E__!.setMode("source");
    });
    const afterModes = await diagnostics(page);
    expect(afterModes.renderer).toMatchObject({
      viewId: beforeModes.renderer!.viewId,
      stateEpochId: beforeModes.renderer!.stateEpochId,
      markdown: beforeModes.renderer!.markdown,
      selectionAnchor: beforeModes.renderer!.selectionAnchor,
      selectionHead: beforeModes.renderer!.selectionHead,
      undoDepth: beforeModes.renderer!.undoDepth,
      redoDepth: beforeModes.renderer!.redoDepth,
      focused: true,
    });
    expect(
      Math.abs(afterModes.renderer!.scrollTop - beforeModes.renderer!.scrollTop),
    ).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.triggerParentRerender());
    await expect(page.getByRole("alert")).toContainText("E2E rerender");
    const afterRerender = await diagnostics(page);
    expect(afterRerender.renderer).toMatchObject({
      viewId: afterModes.renderer!.viewId,
      stateEpochId: afterModes.renderer!.stateEpochId,
      markdown: afterModes.renderer!.markdown,
      selectionAnchor: afterModes.renderer!.selectionAnchor,
      selectionHead: afterModes.renderer!.selectionHead,
      undoDepth: afterModes.renderer!.undoDepth,
      scrollTop: afterModes.renderer!.scrollTop,
    });
    expect(afterRerender.platform.registration).toEqual(afterModes.platform.registration);
    expect(afterRerender.platform).toMatchObject({ attachCount: 1, factoryCount: 1 });

    const beforeInput = await diagnostics(page);
    await content.type("x");
    await expect
      .poll(async () => (await diagnostics(page)).snapshot.contentRevision)
      .toBe(beforeInput.snapshot.contentRevision + 1);
    const afterInput = await diagnostics(page);
    expect(afterInput.renderer!.documentTransactionCount).toBe(
      beforeInput.renderer!.documentTransactionCount + 1,
    );
    expect(afterInput.transitionCounts.content).toBe(
      (beforeInput.transitionCounts.content ?? 0) + 1,
    );
    expect(afterInput.renderer!.lastAcknowledgedRendererSequence).toBe(
      afterInput.renderer!.highestPublishedRendererSequence,
    );
    expect(afterInput.renderer!.reconciliationTransactionCount).toBe(
      beforeInput.renderer!.reconciliationTransactionCount,
    );

    await content.press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(beforeInput.renderer!.markdown);
    await content.press(REDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(afterInput.renderer!.markdown);
  });

  test("E4: applies one isolated same-document external edit and keeps it undoable", async ({
    page,
  }) => {
    await openFixture(page, "/fixtures/same-a.md");
    const content = page.locator(".cm-content");
    await content.click();
    await content.press("Control+End");
    const before = await diagnostics(page);
    const result = await page.evaluate(() =>
      window.__MD_EDITOR_E2E__!.applyExternalEdit("# External\n\nreplacement\n"),
    );
    expect(result.status).toBe("applied");

    const after = await diagnostics(page);
    expect(after.renderer!.externalEditTransactionCount).toBe(
      before.renderer!.externalEditTransactionCount + 1,
    );
    expect(after.renderer!.documentTransactionCount).toBe(
      before.renderer!.documentTransactionCount + 1,
    );
    expect(after.transitionCounts.content).toBe((before.transitionCounts.content ?? 0) + 1);
    expect(after.renderer!.lastSyncStatus).toBe("acknowledged");
    expect(after.renderer!.markdown).toBe("# External\n\nreplacement\n");

    await content.press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(before.renderer!.markdown);
  });

  test("E5-E7: resets state at every document boundary and exposes one engine", async ({
    page,
  }) => {
    await openFixture(page, "/fixtures/same-a.md");
    const content = page.locator(".cm-content");
    const scroller = page.locator(".cm-scroller");
    await content.click();
    await content.press("Control+End");
    await content.type("history");
    await scroller.evaluate((element) => {
      element.scrollTop = 100;
      element.dispatchEvent(new Event("scroll"));
    });
    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.enqueueSaveBehavior({ status: "success", actualPath: "/fixtures/e5-saved.md" });
      await bridge.save();
    });
    const before = await diagnostics(page);

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.createNewDocument());
    const newDocument = await diagnostics(page);
    expect(newDocument.renderer).toMatchObject({
      viewId: before.renderer!.viewId,
      documentGeneration: before.snapshot.documentGeneration + 1,
      markdown: "",
      selectionAnchor: 0,
      selectionHead: 0,
      scrollTop: 0,
      undoDepth: 0,
      redoDepth: 0,
    });
    expect(newDocument.renderer!.stateEpochId).not.toBe(before.renderer!.stateEpochId);

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.openFixture("/fixtures/same-a.md"));
    const firstIdentical = await diagnostics(page);
    expect(firstIdentical.snapshot.documentGeneration).toBe(
      newDocument.snapshot.documentGeneration + 1,
    );
    expect(firstIdentical.renderer).toMatchObject({ markdown: "# Identical\n", undoDepth: 0 });

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.openFixture("/fixtures/same-b.md"));
    const identical = await diagnostics(page);
    expect(identical.renderer!.viewId).toBe(before.renderer!.viewId);
    expect(identical.renderer!.stateEpochId).not.toBe(firstIdentical.renderer!.stateEpochId);
    expect(identical.snapshot.documentGeneration).toBe(
      firstIdentical.snapshot.documentGeneration + 1,
    );
    expect(identical.renderer).toMatchObject({ undoDepth: 0, redoDepth: 0, selectionAnchor: 0 });

    expect(identical.cmEditorCount).toBe(1);
    expect(identical.proseMirrorCount).toBe(0);
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await expect(page.locator("[data-editor-engine], [aria-label*='引擎']")).toHaveCount(0);
  });

  test("D3: opening an empty folder creates a fresh blank document boundary", async ({ page }) => {
    await openFixture(page, "/fixtures/same-a.md");
    const before = await diagnostics(page);
    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.setFolderEmpty(true);
      await bridge.openFolder();
    });
    const firstBlank = await diagnostics(page);
    expect(firstBlank.snapshot).toMatchObject({
      markdown: "",
      savedMarkdown: "",
      filePath: null,
      isDirty: false,
      documentGeneration: before.snapshot.documentGeneration + 1,
    });

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.openFolder());
    const secondBlank = await diagnostics(page);
    expect(secondBlank.snapshot.documentGeneration).toBe(
      firstBlank.snapshot.documentGeneration + 1,
    );
    expect(secondBlank.renderer!.stateEpochId).not.toBe(firstBlank.renderer!.stateEpochId);
  });

  test("P5: only a main page reload creates one newer save-runtime epoch", async ({ page }) => {
    await openFixture(page, "/fixtures/same-a.md");
    const before = await diagnostics(page);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__MD_EDITOR_E2E__?.version)).toBe(2);
    const after = await diagnostics(page);
    expect(after.platform).toMatchObject({ attachCount: 1, factoryCount: 1 });
    expect(after.platform.registration).toMatchObject({
      epoch: before.platform.registration!.epoch + 1,
      id: before.platform.registration!.id + 1,
      sequenceSeed: 0,
    });
  });

  test("E8: retains only the latest external edit during composition and lets local input win", async ({
    page,
  }) => {
    await openFixture(page, "/fixtures/same-a.md");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(true));
    const queued = await page.evaluate(() => [
      window.__MD_EDITOR_E2E__!.applyExternalEdit("first queued\n"),
      window.__MD_EDITOR_E2E__!.applyExternalEdit("second queued\n"),
    ]);
    expect(queued.map((result) => result.status)).toEqual([
      "queued-composition",
      "queued-composition",
    ]);
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(false));
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe("second queued\n");

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(true));
    expect(
      await page.evaluate(() => window.__MD_EDITOR_E2E__!.applyExternalEdit("must be stale\n")),
    ).toMatchObject({ status: "queued-composition" });
    const content = page.locator(".cm-content");
    await content.click();
    await content.press("Control+End");
    await content.type("local");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(false));
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.queuedExternalEditOperationId)
      .toBeNull();
    const afterLocal = await diagnostics(page);
    expect(afterLocal.renderer!.markdown).toContain("local");
    expect(afterLocal.renderer!.markdown).not.toBe("must be stale\n");
  });

  test("E9: keeps renderer identity/history/selection/scroll across asset preview", async ({
    page,
  }) => {
    await openFixture(page, SCROLL_FIXTURE);
    const content = page.locator(".cm-content");
    const scroller = page.locator(".cm-scroller");
    await content.click();
    await content.press("Control+End");
    await content.type("preview-history");
    await content.press("Shift+ArrowLeft");
    await scroller.evaluate((element) => {
      element.scrollTop = 400;
      element.dispatchEvent(new Event("scroll"));
    });
    const before = await diagnostics(page);

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setAssetPreviewVisible(true));
    await expect(
      page.getByLabel("Markdown 编辑器").locator(".code-mirror-editor-host"),
    ).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setAssetPreviewVisible(false));
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.measureRequestCount)
      .toBe(before.renderer!.measureRequestCount + 1);

    const after = await diagnostics(page);
    expect(after.renderer).toMatchObject({
      viewId: before.renderer!.viewId,
      stateEpochId: before.renderer!.stateEpochId,
      markdown: before.renderer!.markdown,
      undoDepth: before.renderer!.undoDepth,
      selectionAnchor: before.renderer!.selectionAnchor,
      selectionHead: before.renderer!.selectionHead,
      scrollTop: before.renderer!.scrollTop,
    });
  });

  test("E10: serializes overlapping saves, preserves LF, and isolates settings", async ({
    context,
    page,
  }) => {
    await openFixture(page, "/fixtures/same-a.md");
    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.applyExternalEdit("lower\r\nvalue\r");
      bridge.enqueueSaveBehavior({
        status: "success",
        actualPath: "/fixtures/lower.md",
        delayMs: 40,
      });
      const lower = bridge.save(true);
      bridge.applyExternalEdit("higher\r\nvalue\r");
      bridge.enqueueSaveBehavior({ status: "success", actualPath: "/fixtures/higher.md" });
      await Promise.all([lower, bridge.save(true)]);
    });
    let after = await diagnostics(page);
    expect(after.snapshot).toMatchObject({
      markdown: "higher\nvalue\n",
      savedMarkdown: "higher\nvalue\n",
      filePath: "/fixtures/higher.md",
      isDirty: false,
      persistenceStatus: { kind: "verified" },
    });
    expect(await persisted(page, "/fixtures/lower.md")).toBe("lower\nvalue\n");
    expect(await persisted(page, "/fixtures/higher.md")).toBe("higher\nvalue\n");
    expect(after.platform.maxConcurrentNativeJobs).toBe(1);

    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.replaceDocument("base\n", "/fixtures/base.md");
      bridge.applyExternalEdit("promoted lower\n");
      bridge.enqueueSaveBehavior({
        status: "success",
        actualPath: "/fixtures/promoted.md",
        delayMs: 30,
      });
      const lower = bridge.save(true);
      bridge.applyExternalEdit("failed higher\n");
      bridge.enqueueSaveBehavior({ status: "failure" });
      await Promise.all([lower, bridge.save(true)]);
    });
    after = await diagnostics(page);
    expect(after.snapshot).toMatchObject({
      markdown: "failed higher\n",
      savedMarkdown: "promoted lower\n",
      filePath: "/fixtures/promoted.md",
      isDirty: true,
    });
    expect(await persisted(page, "/fixtures/promoted.md")).toBe("promoted lower\n");

    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.replaceDocument("known\n", "/fixtures/unknown.md");
      bridge.applyExternalEdit("unknown result\n");
      bridge.enqueueSaveBehavior({ status: "indeterminate" });
      await bridge.save();
    });
    expect((await diagnostics(page)).snapshot.persistenceStatus.kind).toBe("verification-required");
    await expect(page.getByRole("alert")).toContainText("无法确认保存是否完成");
    await page.evaluate(async () => {
      const bridge = window.__MD_EDITOR_E2E__!;
      bridge.applyExternalEdit("known recovery\n");
      bridge.enqueueSaveBehavior({ status: "warning", actualPath: "/fixtures/recovered.md" });
      await bridge.save(true);
    });
    after = await diagnostics(page);
    expect(after.snapshot).toMatchObject({
      savedMarkdown: "known recovery\n",
      filePath: "/fixtures/recovered.md",
      isDirty: false,
      persistenceStatus: { kind: "verified" },
    });
    await expect(page.getByRole("alert")).toContainText("附加操作警告");

    const registrationBeforeSettings = after.platform.registration;
    const settingsPage = await context.newPage();
    await settingsPage.goto("/?window=settings");
    await expect(settingsPage.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
    expect(await settingsPage.evaluate(() => window.__MD_EDITOR_E2E__)).toBeUndefined();
    await settingsPage.reload();
    await expect(settingsPage.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
    expect(await settingsPage.evaluate(() => window.__MD_EDITOR_E2E__)).toBeUndefined();
    await settingsPage.close();

    await page.evaluate(async () => {
      window.__MD_EDITOR_E2E__!.enqueueSaveBehavior({
        status: "success",
        actualPath: "/fixtures/after-settings.md",
      });
      await window.__MD_EDITOR_E2E__!.save(true);
    });
    after = await diagnostics(page);
    expect(after.platform.registration).toEqual(registrationBeforeSettings);
    expect(after.platform).toMatchObject({ attachCount: 1, factoryCount: 1 });
    expect(after.platform.saveLog.every((entry) => !entry.markdownLf.includes("\r"))).toBe(true);
    expect(after.platform.saveLog.map((entry) => entry.runtimeSequence)).toEqual(
      [...after.platform.saveLog]
        .map((entry) => entry.runtimeSequence)
        .toSorted((left, right) => left - right),
    );
  });

  test("E11: deferred controls report visible typed-unsupported behavior", async ({ page }) => {
    await openFixture(page, "/fixtures/same-a.md");
    const dispositions = await page.evaluate(() =>
      Object.fromEntries(
        window
          .__MD_EDITOR_E2E__!.capabilities.filter((entry) => entry.kind === "command")
          .map((entry) => [entry.id, entry.s1Disposition]),
      ),
    );
    expect(dispositions).toMatchObject({
      "mdx.openComponentMenu": "typed-unsupported",
      "ai.continueWriting": "typed-unsupported",
    });

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.dispatchCommand("mdx.openComponentMenu"));
    await expect(page.getByRole("alert")).toContainText("暂不支持插入 MDX 组件");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.dispatchCommand("ai.continueWriting"));
    await expect(page.getByRole("alert")).toContainText("暂不支持 AI 续写");
  });
});

async function openFixture(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
  await page.evaluate((fixturePath) => window.__MD_EDITOR_E2E__!.openFixture(fixturePath), path);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(async () => (await diagnostics(page)).renderer?.markdown.length ?? 0)
    .toBeGreaterThan(0);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
}

async function persisted(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    (persistedPath) => window.__MD_EDITOR_E2E__!.readPersistedMarkdown(persistedPath),
    path,
  );
}
