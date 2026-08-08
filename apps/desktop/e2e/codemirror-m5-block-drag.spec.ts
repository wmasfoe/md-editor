import { expect, test, type Page } from "@playwright/test";

const FIXTURE = ["标题一", "", "段落甲", "", "段落乙", "", "段落丙", ""].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  // 真实桌面 App 的编辑区有左侧留白;harness 默认无 padding,给 .cm-content
  // 注入等量留白,否则块工具栏的负边距会被推出视口
  await page.addStyleTag({
    content: ".cm-content { padding-left: 88px !important; }",
  });
  // 先等 harness 就绪再 mountEditor(React 并发渲染下 bridge 对象
  // 出现早于 controls 赋值,mountEditor 需要 controls;macOS 慢 runner 间歇)
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

test.describe("块工具栏与拖拽(块拖拽迁移)", () => {
  test("B1: 每个块行首渲染工具栏(加号 + 六点手柄)", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const toolbars = page.locator(".cm-md-block-toolbar");
    // 标题 + 3 段落 = 4 块
    await expect(toolbars).toHaveCount(4);
    await expect(page.locator(".cm-md-block-add").first()).toBeVisible();
    await expect(page.locator(".cm-md-block-drag-handle").first()).toBeVisible();
  });

  test("B2: 加号在块下方插入空行", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // hover 行显示工具栏(opacity 0.15 → 1),再点该行自己的加号
    const line = page.locator(".cm-line", { hasText: "段落甲" }).first();
    await line.hover();
    const addButton = line.locator(".cm-md-block-add").first();
    await addButton.click({ force: true });
    // 块下方插入空行:文档新增一个空行(段落甲后出现空行)
    const markdownAfter = (await diagnostics(page)).renderer?.markdown ?? "";
    expect(markdownAfter).toContain("段落甲\n\n\n");
  });

  test("B3: 拖拽手柄把块移到目标位置(pointer 拖拽)", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // hover 显示工具栏,取"段落甲"手柄与"段落丙"行的实际位置
    const sourceLine = page.locator(".cm-line", { hasText: "段落甲" }).first();
    await sourceLine.hover();
    const handle = sourceLine.locator(".cm-md-block-drag-handle").first();
    const handleBox = (await handle.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const targetLine = page.locator(".cm-line", { hasText: "段落丙" }).first();
    const targetBox = (await targetLine.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 越过阈值(4px)后移动到"段落丙"行下半部(after)
    await page.mouse.move(startX, startY + 6, { steps: 3 });
    await page.mouse.move(targetBox.x + 60, targetBox.y + targetBox.height - 4, { steps: 10 });
    await page.mouse.up();

    const markdown = (await diagnostics(page)).renderer?.markdown ?? "";
    // 段落甲移到段落丙之后
    const lines = markdown.split("\n").filter((line) => line.length > 0);
    expect(lines).toEqual(["标题一", "段落乙", "段落丙", "段落甲"]);
  });
});
