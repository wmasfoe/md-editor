import { expect, test, type Page } from "@playwright/test";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const LINK_DOCUMENT = [
  "Before",
  "",
  "[示例文档](https://example.com/readme)",
  "",
  "After",
  "",
].join("\n");
const DANGEROUS_DOCUMENT = ["Before", "", "[危险](javascript:alert(1))", "", "After", ""].join(
  "\n",
);

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.mountEditor());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function replaceDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
  }, markdown);
}

async function openedLinks(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getOpenedLinks() ?? []);
}

async function diagnostics(page: Page): Promise<{
  renderer?: { markdown?: string; wysiwygProjection?: { activeSyntaxIds: readonly string[] } };
}> {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics());
}

test.describe("链接交互(M5 链接打开迁移)", () => {
  test("L1: 非 active 链接渲染为可打开的 <a href>", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, LINK_DOCUMENT);

    const link = page.locator(".cm-md-link");
    await expect(link).toHaveCount(1);
    // 渲染为真 <a>,href 来自源码 URL(协议白名单通过)
    await expect(link).toHaveAttribute("href", "https://example.com/readme");
  });

  test("L2: 危险协议链接不渲染为 <a>(fail-closed)", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, DANGEROUS_DOCUMENT);

    const link = page.locator(".cm-md-link");
    await expect(link).toHaveCount(1);
    // javascript: 被协议白名单拒绝 → 不是 <a>,没有 href
    await expect(link).not.toHaveAttribute("href", /javascript/);
    expect(await link.evaluate((el) => el.tagName)).not.toBe("A");
  });

  test("L3: Cmd/Ctrl+点击打开链接,普通点击 reveal 源码", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, LINK_DOCUMENT);

    // modifier 点击:打开链接(回调收到 URL),文档不变
    const beforeMarkdown = (await diagnostics(page)).renderer?.markdown;
    await page
      .locator(".cm-md-link")
      .click({ modifiers: [MOD_KEY === "Meta" ? "Meta" : "Control"] });
    await expect.poll(async () => openedLinks(page)).toEqual(["https://example.com/readme"]);
    expect((await diagnostics(page)).renderer?.markdown ?? "").toBe(beforeMarkdown ?? "");

    // 普通点击:光标进入 label → 链接转为显示源码(activeSyntaxIds 包含链接;
    // active 时 <a> 装饰移除,故在点击前重新加载文档)
    await replaceDocument(page, LINK_DOCUMENT);
    await page.locator(".cm-md-link").click();
    await expect
      .poll(
        async () =>
          (await diagnostics(page)).renderer?.wysiwygProjection?.activeSyntaxIds.length ?? 0,
      )
      .toBeGreaterThan(0);
  });

  test("L4: Mod-Enter 在链接上打开", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, LINK_DOCUMENT);

    // 光标放进链接 label(普通点击),再按 Mod-Enter
    await page.locator(".cm-md-link").click();
    await page.keyboard.press(`${MOD_KEY}+Enter`);
    await expect.poll(async () => openedLinks(page)).toEqual(["https://example.com/readme"]);
  });
});
