import { expect, test, type Page } from "@playwright/test";

const FIXTURE = [
  "# 标题一",
  "",
  "段落甲",
  "",
  "段落乙",
  "",
  "## 标题二",
  "",
  "段落丙",
  "",
  "- 列表一",
  "- 列表二",
  "  - 子项一",
  "- 列表三",
  "",
].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await page.addStyleTag({
    content: ".cm-content { padding-left: 92px !important; }",
  });
  // 先等 harness 就绪再 mountEditor:React 并发渲染下 bridge 对象
  // 出现早于 controls 赋值,mountEditor 需要 controls,顺序反了会抛
  // "The CodeMirror editor harness is not ready"(macOS 慢 runner 间歇)
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

test.describe("M5 折叠(标题/列表项)", () => {
  test("F1: 标题行有折叠按钮,点击折叠/展开内容区,markdown 不变", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // 标题一行首有折叠按钮(未折叠:▾, aria-expanded=true)
    const headingLine = page.locator(".cm-line", { hasText: "标题一" }).first();
    await headingLine.hover();
    const toggle = headingLine.locator(".cm-md-fold-toggle");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("data-collapsed", "false");

    // 点击折叠:段落甲/乙隐藏(到 ## 标题二 前),markdown 不变
    await toggle.click({ force: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("data-collapsed", "true");
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(0);
    await expect(page.locator(".cm-line", { hasText: "段落乙" })).toHaveCount(0);
    expect((await diagnostics(page)).renderer?.markdown).toBe(FIXTURE);

    // 再点展开恢复
    await toggle.click({ force: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(1);
    expect((await diagnostics(page)).renderer?.markdown).toBe(FIXTURE);
  });

  test("F2: 有子项的列表项可折叠,无子项的不显示按钮", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // 有子项 b1 的"列表二"有按钮
    const listTwoLine = page.locator(".cm-line", { hasText: "列表二" }).first();
    await listTwoLine.hover();
    await expect(listTwoLine.locator(".cm-md-fold-toggle")).toHaveCount(1);
    // 无子项的"列表一"无按钮
    const listOneLine = page.locator(".cm-line", { hasText: "列表一" }).first();
    await listOneLine.hover();
    await expect(listOneLine.locator(".cm-md-fold-toggle")).toHaveCount(0);

    // 点击折叠"列表二"的子项
    await listTwoLine.locator(".cm-md-fold-toggle").click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "子项一" })).toHaveCount(0);
    expect((await diagnostics(page)).renderer?.markdown).toBe(FIXTURE);
    await listTwoLine.locator(".cm-md-fold-toggle").click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "子项一" })).toHaveCount(1);
  });

  test("F3: 折叠后折叠区外编辑正常,折叠区内容隐藏", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // 折叠"标题二"(H2,无同级 H2 → 折叠到文档尾:段落丙 + 列表);
    // 折叠区外 = 标题二之前(段落甲/乙)。先 hover 显示工具栏区
    const headingLine = page.locator(".cm-line", { hasText: "标题二" }).first();
    await headingLine.hover();
    const toggle = headingLine.locator(".cm-md-fold-toggle");
    await toggle.click({ force: true });
    // 折叠后 DOM 无"段落丙"行(用页面查询断言:locator hasText 与 CM6
    // 折叠占位行有解析怪癖,toHaveCount 会误匹配)
    const hits = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>(".cm-line")).filter((line) =>
          (line.textContent ?? "").includes("段落丙"),
        ).length,
    );
    expect(hits).toBe(0);

    // 程序化定位到"段落甲"文本后(折叠区外)并输入
    const afterText = FIXTURE.indexOf("段落甲") + "段落甲".length;
    await page.evaluate(
      ([from]) => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(from, from),
      [afterText],
    );
    await page.keyboard.insertText("X");
    const markdownAfter = (await diagnostics(page)).renderer?.markdown ?? "";
    expect(markdownAfter).toContain("段落甲X");
    // 折叠区(段落丙)仍隐藏,markdown 结构未被折叠破坏
    const hitsAfter = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>(".cm-line")).filter((line) =>
          (line.textContent ?? "").includes("段落丙"),
        ).length,
    );
    expect(hitsAfter).toBe(0);
  });

  test("F4: 折叠/展开是渲染层操作,不进 undo 历史", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const toggle = page
      .locator(".cm-line", { hasText: "标题一" })
      .first()
      .locator(".cm-md-fold-toggle");
    await toggle.click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(0);
    const foldedMarkdown = (await diagnostics(page)).renderer?.markdown;

    // undo 不应撤销折叠(渲染层),文档不变
    await page.keyboard.press("Control+z");
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(0);
    expect((await diagnostics(page)).renderer?.markdown).toBe(foldedMarkdown);

    // 展开恢复
    await toggle.click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(1);
  });

  test("F5: 折叠状态下模式切换(source ↔ wysiwyg)不崩溃、状态保持", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const toggle = page
      .locator(".cm-line", { hasText: "标题一" })
      .first()
      .locator(".cm-md-fold-toggle");
    await toggle.click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(0);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("source"));
    await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "source");
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setMode("wysiwyg"));
    await expect(page.locator(".cm-editor")).toHaveAttribute("data-editor-mode", "wysiwyg");

    // 折叠状态保持(回到 wysiwyg 后段落甲仍隐藏)
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(0);
    expect((await diagnostics(page)).renderer?.markdown).toBe(FIXTURE);
    // 还能展开
    await page
      .locator(".cm-line", { hasText: "标题一" })
      .first()
      .locator(".cm-md-fold-toggle")
      .click({ force: true });
    await expect(page.locator(".cm-line", { hasText: "段落甲" })).toHaveCount(1);
  });

  test("F6: 折叠按钮并入块工具栏,可见可点击", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const headingLine = page.locator(".cm-line", { hasText: "标题一" }).first();
    await headingLine.hover();
    const toolbar = headingLine.locator(".cm-md-block-toolbar").first();
    const toggle = headingLine.locator(".cm-md-fold-toggle");
    await expect(toolbar).toHaveCount(1);
    await expect(toggle).toHaveCount(1);
    // 折叠按钮渲染在工具栏内(并排控件布局由布局诊断覆盖)
    const toolbarBox = await toolbar.boundingBox();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(toggleBox!.x).toBeGreaterThanOrEqual(toolbarBox!.x);
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(
      toolbarBox!.x + toolbarBox!.width + 1,
    );
  });

  test("F7: 折叠图标是伪元素,不污染 .cm-line 文本", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const textContent = await page
      .locator(".cm-line", { hasText: "标题一" })
      .first()
      .evaluate((element) => element.textContent ?? "");
    expect(textContent).not.toContain("▾");
    expect(textContent).not.toContain("▸");
    expect(textContent).toContain("标题一");
  });
});
