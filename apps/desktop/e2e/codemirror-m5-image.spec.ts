import { expect, test, type Page } from "@playwright/test";

const FIXTURE = ["# 标题", "", '![猫](cat.png "一只猫")', "", "段落", ""].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await page.addStyleTag({
    content: ".cm-content { padding-left: 112px !important; }",
  });
  // 先等 harness 就绪再 mountEditor(React 并发渲染竞态,3b55ee1 教训)
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.isReady() ?? false))
    .toBe(true);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.mountEditor());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function replaceDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
  }, markdown);
}

async function diagnostics(page: Page): Promise<{ renderer?: { markdown?: string } }> {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics());
}

test.describe("M5 图片闭环(就地编辑源码 + 查看器)", () => {
  test("I1: 点击图片原子选中,显示源码编辑行并预填 markdown", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const image = page.locator(".cm-md-image-widget");
    await expect(image).toHaveCount(1);
    await image.click({ force: true });
    await expect(image).toHaveAttribute("aria-selected", "true");
    const sourceRow = image.locator(".cm-md-image-widget__source-row");
    await expect(sourceRow).toBeVisible();
    await expect(sourceRow.locator(".cm-md-image-widget__source")).toHaveValue(
      '![猫](cat.png "一只猫")',
    );
  });

  test("I2: 编辑源码后 Enter 同步到文档", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const image = page.locator(".cm-md-image-widget");
    await image.click({ force: true });
    const sourceInput = image.locator(".cm-md-image-widget__source");
    await sourceInput.fill("![狗](dog.png)");
    await sourceInput.press("Enter");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toContain("![狗](dog.png)");
    // 原图片被替换,新图片渲染
    await expect(page.locator(".cm-md-image-widget")).toHaveCount(1);
  });

  test("I3: 清空源码 Enter 删除图片", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const image = page.locator(".cm-md-image-widget");
    await image.click({ force: true });
    const sourceInput = image.locator(".cm-md-image-widget__source");
    await sourceInput.fill("");
    await sourceInput.press("Enter");
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .not.toContain("cat.png");
    await expect(page.locator(".cm-md-image-widget")).toHaveCount(0);
  });

  test("I4: 查看器按钮打开全屏浮层,Escape 关闭", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const image = page.locator(".cm-md-image-widget");
    await image.hover();
    const viewerButton = image.locator(".cm-md-image-widget__viewer");
    await viewerButton.click({ force: true });
    const overlay = page.locator(".cm-md-image-viewer");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("img")).toHaveAttribute("src", "cat.png");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
  });

  test("I5: 点击图片外关闭源码编辑行", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const image = page.locator(".cm-md-image-widget");
    await image.click({ force: true });
    await expect(image.locator(".cm-md-image-widget__source-row")).toBeVisible();
    // 点击段落文本(编辑器内、图片外)
    await page
      .locator(".cm-line", { hasText: "段落" })
      .first()
      .click({ position: { x: 20, y: 8 } });
    await expect(image.locator(".cm-md-image-widget__source-row")).toBeHidden();
  });
});
