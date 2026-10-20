import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * 手测清单的自动化代理（人工清单仍需属主最终确认手感）：
 * - 中文 IME 在加粗内部输入：不吞字、组合期不重建；
 * - 光标从加粗右侧连续 ←：不卡在折叠的 `**` 上；
 * - 选区端点落在 marker 边界：显形正确、文档不变；
 * - 全选复制：剪贴板仍是完整 markdown（隐藏只影响视觉）。
 */
const CORE_MARKDOWN = "Head\n\nxx **bold** yy plain tail\n";
const COPY_KEY = process.platform === "darwin" ? "Meta+c" : "Control+c";
const SELECT_ALL_KEY = process.platform === "darwin" ? "Meta+a" : "Control+a";

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function loadMarkdown(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
  }, markdown);
  await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getDiagnostics());
}

async function setSelection(page: Page, from: number, to = from): Promise<void> {
  await page.evaluate(
    ([start, end]) => {
      window.__CODEMIRROR_EDITOR_E2E__!.setSelection(start, end);
    },
    [from, to],
  );
  await expect.poll(async () => (await diagnostics(page)).renderer?.selectionHead).toBe(to);
}

function boldRange(markdown: string): { from: number; to: number } {
  const source = "**bold**";
  const from = markdown.indexOf(source);
  expect(from).toBeGreaterThanOrEqual(0);
  return { from, to: from + source.length };
}

test.describe("行内标记源码显隐 · 手测清单自动化代理", () => {
  test("E-7: 冷启动 ON（facet 初值，无任何 toggle 事务）首帧即常显", async ({ page }) => {
    await page.goto("/?surface=codemirror-editor&inlineStyleMarkers=1");
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("Head\n\nxx **bold** yy\n", "wysiwyg");
    });
    // 未调用任何 setInlineStyleMarkers：marker 来自创建时的 facet 初值。
    await expect(page.locator(".cm-md-marker--bold")).toHaveCount(2);
  });

  test.beforeEach(async ({ context, page }) => {
    await grantClipboard(context);
    await openHarness(page);
  });

  test("IME：在加粗内部输入中文不吞字，且组合期不重建", async ({ page }) => {
    const bold = boldRange(CORE_MARKDOWN);
    await loadMarkdown(page, CORE_MARKDOWN);
    await setSelection(page, bold.from + 3);
    await expect(page.locator(".cm-md-marker--bold")).toHaveCount(2);

    const before = await diagnostics(page);
    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>(".cm-content")!
        .dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await page.keyboard.insertText("中");
    const during = await diagnostics(page);
    expect(during.renderer?.wysiwyg.visibleMarkBuildCount).toBe(
      before.renderer?.wysiwyg.visibleMarkBuildCount,
    );

    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>(".cm-content")!
        .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toContain("中");
    // 组合结束后装饰回到一致状态（光标仍在记录内 ⇒ marker 可见）。
    await expect(page.locator(".cm-md-marker--bold")).toHaveCount(2);
  });

  test("光标从加粗右缘连续 ← 不卡在折叠的 ** 上", async ({ page }) => {
    const bold = boldRange(CORE_MARKDOWN);
    await loadMarkdown(page, CORE_MARKDOWN);
    await setSelection(page, bold.to);

    const heads: number[] = [(await diagnostics(page)).renderer!.selectionHead];
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(async () => (await diagnostics(page)).renderer?.selectionHead)
        .toBe(heads[heads.length - 1] - 1);
      heads.push((await diagnostics(page)).renderer!.selectionHead);
    }
    // 每步都恰好左移 1 个字符：说明折叠掉的 `**` 没有让光标整段跳过。
    expect(heads).toEqual([
      bold.to,
      bold.to - 1,
      bold.to - 2,
      bold.to - 3,
      bold.to - 4,
      bold.to - 5,
    ]);
  });

  test("选区端点落在 marker 边界时不改文档且显形", async ({ page }) => {
    const bold = boldRange(CORE_MARKDOWN);
    await loadMarkdown(page, CORE_MARKDOWN);
    await setSelection(page, bold.from - 1, bold.from + 1);
    await expect(page.locator(".cm-md-marker--bold")).toHaveCount(2);
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(CORE_MARKDOWN);
  });

  test("全选复制仍得到完整 markdown（隐藏只影响视觉）", async ({ page }) => {
    await loadMarkdown(page, CORE_MARKDOWN);
    await setSelection(page, 0);
    await page.keyboard.press(SELECT_ALL_KEY);
    await page.keyboard.press(COPY_KEY);
    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("**bold**");
  });
});
