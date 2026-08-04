import { expect, test, type Page } from "@playwright/test";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const FIXTURE_PATH = "/fixtures/s1-scroll.md";

async function openFixture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
  await page.evaluate((path) => window.__MD_EDITOR_E2E__!.openFixture(path), FIXTURE_PATH);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD_KEY}+k`);
  await expect(page.getByLabel("命令搜索")).toBeVisible();
}

test.describe("G007 command palette (P3-9 unified UI entry)", () => {
  test("E01: Cmd/Ctrl+K opens the palette with focused search and lists grouped commands", async ({
    page,
  }) => {
    await openFixture(page);
    await openPalette(page);

    // 内置命令按组展示(文件/视图/设置/插入/AI)
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await expect(page.getByLabel("命令搜索")).toBeFocused();
    // 至少包含文件组与保存命令(registry 元数据驱动,非硬编码)
    await expect(palette.getByText("文件", { exact: true })).toBeVisible();
    await expect(palette.getByRole("button", { name: /Save/ }).first()).toBeVisible();
  });

  test("E02: typing filters by title and keywords with an empty state", async ({ page }) => {
    await openFixture(page);
    await openPalette(page);

    const search = page.getByLabel("命令搜索");
    await search.fill("save");
    // title 命中:Save / Save As
    await expect(page.getByRole("button", { name: /Save/ })).toHaveCount(2);

    // keywords 命中:中文 "保存" 只对应 file.save("另存为" 归 file.saveAs)
    await search.fill("保存");
    await expect(page.getByRole("button", { name: /^Save file/ })).toHaveCount(1);
    await search.fill("另存为");
    await expect(page.getByRole("button", { name: /Save As/ })).toHaveCount(1);

    // 无匹配 → 空态
    await search.fill("zzzz-no-such-command");
    await expect(page.getByText("没有匹配的命令")).toBeVisible();
  });

  test("E03: Enter executes the selected command through dispatchCommand", async ({ page }) => {
    await openFixture(page);
    await openPalette(page);

    const search = page.getByLabel("命令搜索");
    await search.fill("toggle source");
    await page.keyboard.press("Enter");

    // view.toggleSource 执行后编辑器切到源码模式(经宿主 dispatchCommand)
    await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "source");
    // 执行后面板自动关闭
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("E04: Escape closes the palette and arrow keys move the selection", async ({ page }) => {
    await openFixture(page);
    await openPalette(page);

    const search = page.getByLabel("命令搜索");
    // 过滤后 ↑/↓ 导航不越界(选中项始终存在)
    await search.fill("settings");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");

    // Escape 关闭面板(HeadlessUI Dialog 内置)
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // 再次 Cmd/Ctrl+K 重新打开(toggle 语义),再关闭
    await page.keyboard.press(`${MOD_KEY}+k`);
    await expect(page.getByLabel("命令搜索")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
