import { expect, test, type Page } from "@playwright/test";

const FIXTURE = ["# 标题一", "", "段落甲", "", "## 标题二", "", "段落乙", ""].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await page.addStyleTag({
    content: ".cm-content { padding-left: 112px !important; }",
  });
  // 先等 harness 就绪再 mountEditor(React 并发渲染竞态,本轮 3b55ee1 教训)
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

/** 程序化把光标放到 markdown 的 offset 处(renderer 标准端口,跨平台) */
async function placeCursor(page: Page, offset: number): Promise<void> {
  await page.evaluate(
    ([from]) => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(from, from),
    [offset],
  );
}

test.describe("M5 标题 H 控件", () => {
  test("H1: 光标在 ATX 标题行时行首显示当前级别按钮", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // 初始光标不在标题行,无控件
    await expect(page.locator(".cm-md-heading-level-button")).toHaveCount(0);
    // 光标放到"标题一"文本内
    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    const button = page.locator(".cm-md-heading-level-button");
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAttribute("data-heading-level", "H1");
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("H2: 打开列表选择 H3,marker 重写为 ###", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    const button = page.locator(".cm-md-heading-level-button");
    await button.click({ force: true });
    // 列表出现:段落 + H1-H6(7 个选项)
    await expect(page.locator(".cm-md-heading-level-option")).toHaveCount(7);
    await expect(button).toHaveAttribute("aria-expanded", "true");

    await page
      .locator('.cm-md-heading-level-option[data-heading-level="H3"]')
      .click({ force: true });
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toContain("### 标题一");
  });

  test("H3: 选择段落删除 marker", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    const button = page.locator(".cm-md-heading-level-button");
    await button.click({ force: true });
    await page
      .locator('.cm-md-heading-level-option[data-heading-level="paragraph"]')
      .click({ force: true });
    await expect
      .poll(async () => (await diagnostics(page)).renderer?.markdown)
      .toContain("标题一\n\n段落甲");
  });

  test("H4: 光标离开标题行后控件消失", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    await expect(page.locator(".cm-md-heading-level-button")).toHaveCount(1);
    // 光标移到段落甲
    await placeCursor(page, FIXTURE.indexOf("段落甲") + 2);
    await expect(page.locator(".cm-md-heading-level-button")).toHaveCount(0);
  });

  test("H5: 与块工具栏/折叠按钮共存不重叠", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    const line = page.locator(".cm-line", { hasText: "标题一" }).first();
    await line.hover();
    const toolbarBox = await line.locator(".cm-md-block-toolbar").first().boundingBox();
    const controlBox = await line.locator(".cm-md-heading-level-control").first().boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    // 控件在工具栏右侧,不重叠
    expect(controlBox!.x).toBeGreaterThanOrEqual(toolbarBox!.x + toolbarBox!.width - 1);
  });

  test("H6: Escape 关闭下拉列表", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    await placeCursor(page, FIXTURE.indexOf("标题一") + 2);
    const button = page.locator(".cm-md-heading-level-button");
    await button.click({ force: true });
    await expect(page.locator(".cm-md-heading-level-option")).toHaveCount(7);
    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-md-heading-level-option")).toHaveCount(0);
  });
});
