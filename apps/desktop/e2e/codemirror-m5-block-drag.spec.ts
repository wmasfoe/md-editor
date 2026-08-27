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
  test("B1: 每个块行首渲染 ⋮ 菜单按钮", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    const toolbars = page.locator(".cm-md-block-toolbar");
    // 4 段落块
    await expect(toolbars).toHaveCount(4);
    // ⋮ 菜单按钮(hover 显现)
    const line = page.locator(".cm-line", { hasText: "段落甲" }).first();
    await line.hover();
    await expect(line.locator(".cm-md-block-more").first()).toBeVisible();
  });

  test("B1a: ⋮ 伪元素在固定高度按钮内居中", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, ["# 标题一", "", "段落甲", ""].join("\n"));

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(3, 3));
    const line = page.locator(".cm-line", { hasText: "标题一" }).first();
    await line.hover();
    const more = line.locator(".cm-md-block-more").first();
    await expect(more).toBeVisible();

    const layout = await more.evaluate((element) => {
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      return {
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        beforeDisplay: before.display,
      };
    });
    expect(layout).toEqual({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      beforeDisplay: "block",
    });
  });

  test("B1b: 标题与普通段落的正文起点一致", async ({ page }) => {
    await openHarness(page);
    const source = ["# 标题一", "", "普通段落", ""].join("\n");
    await replaceDocument(page, source);
    await page.evaluate(
      (offset) => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(offset, offset),
      source.indexOf("普通段落") + 2,
    );

    const starts = await page.evaluate(() => {
      const lineStarts = [...document.querySelectorAll(".cm-line")]
        .filter(
          (line) => line.textContent?.includes("标题一") || line.textContent?.includes("普通段落"),
        )
        .map((line) => {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          while (node && !node.textContent) {
            node = walker.nextNode();
          }
          if (!node) {
            throw new Error("Expected visible text in block line.");
          }
          const range = document.createRange();
          range.selectNodeContents(node);
          return { text: line.textContent ?? "", x: range.getBoundingClientRect().x };
        });
      const heading = lineStarts.find((line) => line.text.includes("标题一"));
      const paragraph = lineStarts.find((line) => line.text.includes("普通段落"));
      if (!heading || !paragraph) {
        throw new Error("Expected heading and paragraph lines.");
      }
      return {
        heading: heading.x,
        paragraph: paragraph.x,
      };
    });

    expect(starts.heading).toBeCloseTo(starts.paragraph, 1);
  });

  test("B1c: 表格与代码块和正文共享内容起点", async ({ page }) => {
    await openHarness(page);
    const source = [
      "普通段落",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
    ].join("\n");
    await replaceDocument(page, source);

    const geometry = await page.evaluate(() => {
      const paragraph = [...document.querySelectorAll(".cm-line")].find((line) =>
        line.textContent?.includes("普通段落"),
      );
      const table = document.querySelector<HTMLElement>(".cm-md-table-widget");
      const code = document.querySelector<HTMLElement>(".cm-md-code-toolbar");
      if (!paragraph || !table || !code) {
        throw new Error("Expected paragraph, table, and code-block geometry.");
      }
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) {
        throw new Error("Expected paragraph text geometry.");
      }
      const range = document.createRange();
      range.selectNodeContents(text);
      return {
        paragraph: range.getBoundingClientRect().x,
        table: table.getBoundingClientRect().x,
        code: code.getBoundingClientRect().x,
      };
    });

    expect(geometry.table).toBeCloseTo(geometry.paragraph, 1);
    expect(geometry.code).toBeCloseTo(geometry.paragraph, 1);
  });

  test("B2: ⋮ 菜单的添加块在块下方插入空行", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // hover 显示 ⋮,点开菜单,选"添加块"
    const line = page.locator(".cm-line", { hasText: "段落甲" }).first();
    await line.hover();
    const more = line.locator(".cm-md-block-more").first();
    await more.click({ force: true });
    const menu = line.locator(".cm-md-block-menu").first();
    await expect(menu).toBeVisible();
    await menu.locator(".cm-md-menu-add").first().click({ force: true });
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
    const handle = sourceLine.locator(".cm-md-block-more").first();
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

  test("B4: 窄窗口侧栏折叠时 toolbar 仍可点击", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.openFixture("/fixtures/same-a.md"));
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await expect(page.locator('aside[aria-hidden="true"]')).toHaveCount(1);

    const more = page.locator(".cm-md-block-more").first();
    await more.click();
    await expect(page.locator(".cm-md-block-menu").first()).toBeVisible();

    await page.locator('button.absolute[aria-label="显示侧栏"]').click();
    await expect(page.locator('aside[aria-hidden="false"]')).toHaveCount(1);
  });
});
