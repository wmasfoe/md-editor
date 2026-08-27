import { expect, test, type Page } from "@playwright/test";

const SCROLL_FIXTURE = "/fixtures/s1-scroll.md";

async function openFixture(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
  await page.evaluate((fixturePath) => window.__MD_EDITOR_E2E__!.openFixture(fixturePath), path);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(async () => {
      const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
      return diag.renderer?.markdown.length ?? 0;
    })
    .toBeGreaterThan(0);
}

test.describe("M5 大纲跳转 (Outline Jump)", () => {
  test("O1: 点击标题栏大纲浮层中的标题，正文区域精准跳转并定位光标", async ({ page }) => {
    await openFixture(page, SCROLL_FIXTURE);

    // 1. 点击标题栏大纲按钮展开 Popover (hover 激活可见性并点击)
    const titleBarControls = page.locator(".group\\/titlebar-controls");
    await titleBarControls.hover();
    const outlineButton = page.locator("button[title='大纲']");
    await expect(outlineButton).toBeAttached();
    await outlineButton.click({ force: true });

    // 2. Popover 出现并展示各级标题
    const nav = page.locator("nav[aria-label='文章大纲']");
    await expect(nav).toBeVisible();

    // 3. 点击第 10 节标题 "Section 10" (exact match)
    const targetHeadingButton = nav.getByRole("button", { name: "Section 10", exact: true });
    await expect(targetHeadingButton).toBeVisible();
    await targetHeadingButton.click();

    // 4. Popover 自动关闭
    await expect(nav).toHaveCount(0);

    // 5. 验证光标移动到了 Section 10 且编辑器保持 focus
    await expect
      .poll(async () => {
        const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
        return diag.renderer?.selectionHead ?? 0;
      })
      .toBeGreaterThan(100);

    const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
    expect(diag.renderer?.focused).toBe(true);
  });

  test("O2: 侧栏大纲面板点击标题精准跳转", async ({ page }) => {
    await openFixture(page, SCROLL_FIXTURE);

    // 1. 切换侧栏到大纲视图
    const outlineTabButton = page
      .getByRole("tab", { name: "大纲" })
      .or(page.getByRole("button", { name: "大纲" }));
    if (await outlineTabButton.isVisible()) {
      await outlineTabButton.click();
    }

    const sidebarNav = page.locator("nav[aria-label='大纲目录']");
    await expect(sidebarNav).toBeVisible();

    // 2. 点击第 5 节标题 (exact match)
    const section5Button = sidebarNav.getByRole("button", { name: "Section 5", exact: true });
    await expect(section5Button).toBeVisible();
    await section5Button.click();

    // 3. 验证光标移动且编辑器保持 focus
    await expect
      .poll(async () => {
        const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
        return diag.renderer?.selectionHead ?? 0;
      })
      .toBeGreaterThan(50);

    const diag = await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
    expect(diag.renderer?.focused).toBe(true);
  });
});
