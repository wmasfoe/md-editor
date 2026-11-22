/**
 * @file public-api-ime-baseline.spec.ts
 * @description P0 中文组合输入端到端基线。
 *
 * 仓内此前只有**片段**覆盖（`codemirror-g004-input-fastpath.spec.ts:87` 只验 compositionend
 * 后的标记重建；`codemirror-s1-single-view.spec.ts:243` 只验组合期外部编辑被拒），
 * 没有"组合 → 提交 → 单步 undo → 光标位置"的完整链路。
 *
 * 这是 P3/P4 动 ports 与注册语义时"不丢字、不卡顿"的判据来源。
 */
import { expect, test, type Page } from "@playwright/test";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&standalone=1");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()))
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

async function rendererState(page: Page) {
  const diagnostics = await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics());
  const renderer = diagnostics?.renderer;
  if (!renderer) throw new Error("renderer is unavailable");
  return renderer;
}

test("中文组合输入：提交后文本正确、单步 undo 回到组合前、光标在末尾", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("", "wysiwyg"));
  await page.locator(".cm-content").click();
  const before = await rendererState(page);

  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(true));
  await page.keyboard.insertText("你好");
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(false));

  await expect.poll(async () => (await rendererState(page)).markdown).toBe("你好");
  const selection = await page.evaluate(() =>
    window.__CODEMIRROR_EDITOR_E2E__?.getSelectionSnapshot(),
  );
  expect(selection).toMatchObject({ head: 2, from: 2 });

  const after = await rendererState(page);
  expect(after.undoDepth).toBeGreaterThan(before.undoDepth);

  await page.locator(".cm-content").click();
  await page.keyboard.press(`${MOD_KEY}+z`);
  await expect.poll(async () => (await rendererState(page)).markdown).toBe("");
});

test("组合期外部编辑被排队，组合结束后按既有语义应用一次", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("", "wysiwyg"));
  await page.locator(".cm-content").click();

  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(true));
  await page.keyboard.insertText("你好");

  // 组合期：外部编辑必须被排队，不能打断本地组合（这是"不丢字"的核心）。
  const queued = await page.evaluate(() =>
    window.__CODEMIRROR_EDITOR_E2E__?.applyExternalEdit("外部覆盖\n"),
  );
  expect(queued).toMatchObject({ status: "queued-composition" });

  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(false));

  // 既有语义（`renderer.test.ts` R13）：组合结束后排队的编辑被应用一次，且不做重放。
  await expect.poll(async () => (await rendererState(page)).markdown).toBe("外部覆盖\n");
  const stable = await rendererState(page);
  await expect.poll(async () => (await rendererState(page)).markdown).toBe(stable.markdown);
});

test("组合结束后外部编辑恢复可用（排队状态不泄漏）", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("起始\n", "wysiwyg"));
  await page.locator(".cm-content").click();

  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(true));
  await page.keyboard.insertText("字");
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setCompositionActive(false));
  await expect.poll(async () => (await rendererState(page)).markdown).toContain("字");

  const applied = await page.evaluate(() =>
    window.__CODEMIRROR_EDITOR_E2E__?.applyExternalEdit("外部内容\n"),
  );
  expect(applied).toMatchObject({ status: "applied" });
  await expect.poll(async () => (await rendererState(page)).markdown).toBe("外部内容\n");
});
