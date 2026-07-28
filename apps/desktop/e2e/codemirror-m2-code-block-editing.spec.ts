import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const EDITING_FIXTURE = [
  "Before",
  "",
  "```ts meta=1",
  "alpha",
  "beta",
  "```",
  "",
  "    indented",
  "    second",
  "",
  "After",
  "",
].join("\n");
const COPY_KEY = process.platform === "darwin" ? "Meta+c" : "Control+c";
const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO_KEY = process.platform === "darwin" ? "Meta+Shift+z" : "Control+y";

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

async function replaceDocument(page: Page, markdown = EDITING_FIXTURE): Promise<void> {
  await page.evaluate((nextMarkdown) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(nextMarkdown, "wysiwyg");
  }, markdown);
  await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
}

function codeLine(page: Page, text: string) {
  return page.locator(".cm-md-code-line").filter({ hasText: text });
}

test.describe("CodeMirror M2 code-block editing", () => {
  test("G005 toolbar preserves source semantics, selection, focus, and one view", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page);

    const initial = await diagnostics(page);
    const language = page.locator(".cm-md-code-toolbar__language");
    const firstToolbar = page.locator(".cm-md-code-toolbar").first();
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(2);
    await expect(language).toHaveCount(1);
    await expect(language).toHaveValue("typescript");

    await codeLine(page, "alpha").click();
    const beforeLanguage = await diagnostics(page);
    await language.selectOption("javascript");
    const javascript = EDITING_FIXTURE.replace("```ts meta=1", "```javascript meta=1");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(javascript);
    expect((await diagnostics(page)).renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      selectionAnchor: (beforeLanguage.renderer?.selectionAnchor ?? 0) + 8,
      selectionHead: (beforeLanguage.renderer?.selectionHead ?? 0) + 8,
    });

    await language.press("Escape");
    await expect.poll(async () => (await diagnostics(page)).renderer?.focused).toBe(true);
    await page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    await language.selectOption("");
    const plain = EDITING_FIXTURE.replace("```ts meta=1", "```text meta=1");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(plain);
    await language.press("Escape");
    await page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    const selectionBeforeCopy = await diagnostics(page);
    await firstToolbar.locator(".cm-md-code-toolbar__copy").click();
    await expect(firstToolbar.locator(".cm-md-code-toolbar__status")).toHaveText("Copied");
    await expect
      .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getCopiedText()))
      .toEqual(["alpha\nbeta\n"]);
    const copied = await diagnostics(page);
    expect(copied.renderer).toMatchObject({
      selectionAnchor: selectionBeforeCopy.renderer?.selectionAnchor,
      selectionHead: selectionBeforeCopy.renderer?.selectionHead,
    });
    expect(copied.renderer?.wysiwyg).toMatchObject({
      codeBlockCopyInvocationCount: 1,
      codeBlockCopySuccessCount: 1,
      codeBlockCopyFailureCount: 0,
    });

    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.failNextClipboardWrite("denied");
    });
    await firstToolbar.locator(".cm-md-code-toolbar__copy").click();
    await expect(firstToolbar.locator(".cm-md-code-toolbar__status")).toHaveText("Copy failed");
    expect((await diagnostics(page)).renderer?.wysiwyg).toMatchObject({
      codeBlockCopyInvocationCount: 2,
      codeBlockCopySuccessCount: 1,
      codeBlockCopyFailureCount: 1,
    });

    await firstToolbar.locator(".cm-md-code-toolbar__select").click();
    const selected = await diagnostics(page);
    expect(selected.renderer).toMatchObject({
      selectionAnchor: EDITING_FIXTURE.indexOf("alpha"),
      selectionHead: EDITING_FIXTURE.indexOf("```", EDITING_FIXTURE.indexOf("alpha")),
      focused: true,
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      markdown: EDITING_FIXTURE,
    });

    const indentedToolbar = page.locator(".cm-md-code-toolbar").nth(1);
    await indentedToolbar.locator(".cm-md-code-toolbar__copy").click();
    await expect(indentedToolbar.locator(".cm-md-code-toolbar__status")).toHaveText("Copied");
    await expect
      .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getCopiedText()))
      .toEqual(["alpha\nbeta\n", "indented\nsecond"]);
  });

  test("G005 keyboard commands edit semantic bodies and protect structural boundaries", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page);
    const initial = await diagnostics(page);

    const alpha = codeLine(page, "alpha");
    await alpha.click();
    const pointerEntry = await diagnostics(page);
    expect(pointerEntry.renderer?.selectionHead).toBeGreaterThanOrEqual(
      EDITING_FIXTURE.indexOf("alpha"),
    );
    expect(pointerEntry.renderer?.selectionHead).toBeLessThanOrEqual(
      EDITING_FIXTURE.indexOf("alpha") + "alpha".length,
    );
    await page.keyboard.press("Home");
    const beforeBoundary = await diagnostics(page);
    await page.keyboard.press("Backspace");
    expect((await diagnostics(page)).renderer).toMatchObject({
      markdown: EDITING_FIXTURE,
      selectionAnchor: beforeBoundary.renderer?.selectionAnchor,
      selectionHead: beforeBoundary.renderer?.selectionHead,
    });

    await page.keyboard.press("Tab");
    const indentedAlpha = EDITING_FIXTURE.replace("alpha", "  alpha");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(indentedAlpha);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    await alpha.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const splitFenced = EDITING_FIXTURE.replace("alpha\nbeta", "alpha\n\nbeta");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(splitFenced);
    await page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    await alpha.click();
    await page.keyboard.press("Meta+a");
    const bodySelected = await diagnostics(page);
    expect(bodySelected.renderer).toMatchObject({
      selectionAnchor: EDITING_FIXTURE.indexOf("alpha"),
      selectionHead: EDITING_FIXTURE.indexOf("```", EDITING_FIXTURE.indexOf("alpha")),
    });
    await page.keyboard.press("Meta+a");
    const documentSelected = await diagnostics(page);
    expect(documentSelected.renderer).toMatchObject({
      selectionAnchor: 0,
      selectionHead: EDITING_FIXTURE.length,
    });

    const secondToolbar = page.locator(".cm-md-code-toolbar").nth(1);
    await codeLine(page, "indented").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);
    await page.keyboard.press("Tab");
    const semanticIndent = EDITING_FIXTURE.replace("    indented", "      indented");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(semanticIndent);
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    await codeLine(page, "second").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const splitIndented = EDITING_FIXTURE.replace(
      "    second\n\nAfter",
      "    second\n    \n\nAfter",
    );
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(splitIndented);
    await page.keyboard.press("Meta+z");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    await secondToolbar.locator(".cm-md-code-toolbar__select").click();
    await page.keyboard.press("ArrowRight");
    const beforeDelete = await diagnostics(page);
    await page.keyboard.press("Delete");
    const afterDelete = await diagnostics(page);
    expect(afterDelete.renderer).toMatchObject({
      markdown: EDITING_FIXTURE,
      selectionAnchor: beforeDelete.renderer?.selectionAnchor,
      selectionHead: beforeDelete.renderer?.selectionHead,
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
    });
    expect(afterDelete.renderer?.wysiwyg.protectedChangeRejectionCount).toBeGreaterThanOrEqual(3);

    await page.keyboard.press("ArrowRight");
    const afterClosingFence = await diagnostics(page);
    expect(afterClosingFence.renderer?.selectionHead).toBeGreaterThan(
      beforeDelete.renderer?.selectionHead ?? 0,
    );
    expect(afterClosingFence.renderer?.markdown).toBe(EDITING_FIXTURE);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));
    const final = await diagnostics(page);
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      markdown: EDITING_FIXTURE,
    });
    expect(final.cmEditorCount).toBe(1);
  });

  test("N09 cross-block drag copies exact Markdown and protects hidden syntax", async ({
    context,
    page,
  }) => {
    await grantClipboard(context);
    await page.setViewportSize({ width: 1200, height: 800 });
    await openHarness(page);
    await replaceDocument(page);
    const initial = await diagnostics(page);

    const selection = await dragSelection(
      page,
      lineWithText(page, "Before"),
      lineWithText(page, "After"),
    );
    const expected = EDITING_FIXTURE.slice(selection.from, selection.to);
    expect(expected).toContain("```ts meta=1\nalpha\nbeta\n```");
    expect(expected).toContain("    indented\n    second");

    await page.locator(".cm-content").press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe(expected);
    const copied = await diagnostics(page);
    const rejectionCount = copied.renderer?.wysiwyg.protectedChangeRejectionCount ?? 0;

    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);
    await page.keyboard.insertText("replacement");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);

    const final = await diagnostics(page);
    expect(final).toMatchObject({ cmEditorCount: 1 });
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      markdown: EDITING_FIXTURE,
    });
    expect(final.renderer?.wysiwyg.protectedChangeRejectionCount).toBe(rejectionCount + 2);
  });

  test("N10 code-body composition preserves one history and selection", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page);
    const initial = await diagnostics(page);
    await codeLine(page, "alpha").click();
    await page.keyboard.press("End");

    await setCompositionActive(page, true);
    await page.keyboard.insertText("中文");
    await setCompositionActive(page, false);
    const composed = EDITING_FIXTURE.replace("alpha", "alpha中文");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(composed);

    await page.keyboard.press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(EDITING_FIXTURE);
    await page.keyboard.press(REDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(composed);
    const final = await diagnostics(page);
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      focused: true,
    });
    expect(final.cmEditorCount).toBe(1);
  });

  test("empty fenced bodies accept first input and malformed fences do not indent later content", async ({
    page,
  }) => {
    const directlyTypedEmpty = "```js\n```";
    const directlyTypedPopulated = "```js\nconst direct = true;\n```";
    const empty = "Before\n\n```js\n```\n\nAfter\n";
    const populated = "Before\n\n```js\nconst value = 1;\n```\n\nAfter\n";
    const malformed = "Before\n\n```js\nconst value = 1;\n``\n\nAfter\n";
    await openHarness(page);

    await replaceDocument(page, "");
    await page.locator(".cm-content").click();
    await page.keyboard.insertText("```js");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("```");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(directlyTypedEmpty);
    await expect(page.locator(".cm-md-code-line")).toHaveCount(1);
    const rejectionCount = (await diagnostics(page)).renderer?.wysiwyg
      .protectedChangeRejectionCount;
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(directlyTypedEmpty);
    expect((await diagnostics(page)).renderer?.wysiwyg.protectedChangeRejectionCount).toBe(
      (rejectionCount ?? 0) + 1,
    );
    await page.keyboard.insertText("const direct = true;");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toBe(directlyTypedPopulated);

    await replaceDocument(page, empty);
    const initial = await diagnostics(page);

    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(1);
    const emptyCodeLine = page.locator(".cm-md-code-line");
    await expect(emptyCodeLine).toHaveCount(1);
    await emptyCodeLine.click({ position: { x: 12, y: 8 } });
    await page.keyboard.insertText("const value = 1;");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(populated);
    await expect(codeLine(page, "const value = 1;")).toHaveCount(1);
    await page.keyboard.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(empty);
    await page.keyboard.press(REDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(populated);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    const closingFence = page.locator(".cm-line").filter({ hasText: "```" }).last();
    await closingFence.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(malformed);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(0);
    await expect(page.locator(".cm-md-code-line")).toHaveCount(0);
    const ordinaryLineGeometry = await page.evaluate(() => {
      const lines = [...document.querySelectorAll<HTMLElement>(".cm-line")];
      const before = lines.find((line) => line.textContent === "Before");
      const after = lines.find((line) => line.textContent === "After");
      if (!before || !after) {
        throw new Error("Ordinary lines are unavailable.");
      }
      return {
        afterText: after.textContent,
        beforeLeft: before.getBoundingClientRect().left,
        afterLeft: after.getBoundingClientRect().left,
      };
    });
    expect(ordinaryLineGeometry.afterText).toBe("After");
    expect(ordinaryLineGeometry.afterLeft).toBeCloseTo(ordinaryLineGeometry.beforeLeft, 0);

    const final = await diagnostics(page);
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
      markdown: malformed,
    });
    expect(final.cmEditorCount).toBe(1);
  });

  test("N12 incomplete fenced code stays raw and repairs in place", async ({ page }) => {
    const malformed = "Before\n\n~~~ts\nbody\n```\n\nAfter\n";
    const repaired = malformed.replace("```", "~~~");
    await openHarness(page);
    await replaceDocument(page, malformed);
    const initial = await diagnostics(page);

    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(0);
    await expect(page.locator(".cm-md-code-line")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("~~~ts");
    await expect(page.locator(".cm-content")).toContainText("```");

    const closingFence = lineWithText(page, "```");
    await closingFence.click({ position: { x: 6, y: 8 } });
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.insertText("~~~");
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(repaired);
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(1);

    await page.keyboard.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(malformed);
    await expect(page.locator(".cm-md-code-toolbar")).toHaveCount(0);
    const final = await diagnostics(page);
    expect(final.renderer).toMatchObject({
      viewId: initial.renderer?.viewId,
      stateEpochId: initial.renderer?.stateEpochId,
    });
    expect(final.cmEditorCount).toBe(1);
  });
});

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function setCompositionActive(page: Page, active: boolean): Promise<void> {
  await page.evaluate((nextActive) => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("CodeMirror content is not mounted.");
    content.dispatchEvent(
      new CompositionEvent(nextActive ? "compositionstart" : "compositionend", {
        bubbles: true,
      }),
    );
  }, active);
}

function lineWithText(page: Page, text: string): Locator {
  return page.locator(".cm-line").filter({ hasText: text }).first();
}

async function dragSelection(
  page: Page,
  first: Locator,
  second: Locator,
): Promise<{ readonly from: number; readonly to: number }> {
  const startBox = await first.boundingBox();
  const endBox = await second.boundingBox();
  if (!startBox || !endBox) throw new Error("Cross-block drag endpoints must be rendered.");
  await page.mouse.move(startBox.x + startBox.width * 0.2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width * 0.8, endBox.y + endBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const renderer = (await diagnostics(page)).renderer;
  if (!renderer) throw new Error("Renderer diagnostics are unavailable after drag selection.");
  return {
    from: Math.min(renderer.selectionAnchor, renderer.selectionHead),
    to: Math.max(renderer.selectionAnchor, renderer.selectionHead),
  };
}
