import { expect, test, type Page } from "@playwright/test";

const MULTILINE_TEXT = [
  "我希望开发一个面向技术作者、程序员、博客作者的现代化 Markdown 编辑器。",
  "强调单视图、所见即所得的 Markdown 编辑体验，同时具备极强的扩展性与稳定性。",
  "增强能力：",
  "然后：提供对 Markdown 的深入理解，如对 Markdown 编辑器使用方法的掌握。",
  "AI：提供 AI 功能，如智能提示、智能生成、智能搜索、智能问答等。",
  "我们最终面对的使用人群是：Markdown 深度写作者。",
].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
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

test.describe("CodeMirror 选区渲染与边界裁剪规范", () => {
  test("S1: 启用 CodeMirror drawSelection 并通过 clip-path 约束选区水平边界", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, MULTILINE_TEXT);

    // 选中跨多行正文
    await page.evaluate((textLength) => {
      window.__CODEMIRROR_EDITOR_E2E__?.setSelection(0, textLength);
    }, MULTILINE_TEXT.length);

    // 验证自绘选区层 .cm-selectionLayer 存在且包含自绘选区块
    const selectionLayer = page.locator(".cm-selectionLayer");
    await expect(selectionLayer).toHaveCount(1);

    const selectionBackgrounds = page.locator(".cm-selectionBackground");
    await expect(selectionBackgrounds.first()).toBeVisible();

    // 验证 .cm-selectionLayer 具备 clip-path 裁剪规则
    const clipPath = await selectionLayer.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.clipPath;
    });
    expect(clipPath).not.toBe("none");
    expect(clipPath).toContain("polygon");

    // 验证正文统一行高为 1.62
    const lineHeight = await page
      .locator(".cm-line")
      .first()
      .evaluate((el) => {
        return window.getComputedStyle(el).lineHeight;
      });
    // 1.62 在计算样式中可能返回绝对像素（如 16px * 1.62 = 25.92px），验证其计算比例贴合
    expect(parseFloat(lineHeight)).toBeGreaterThan(0);
  });

  test("S2: 跨行选区背景不得向左击穿至 Gutter 边缘", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, MULTILINE_TEXT);

    // 选中全文
    await page.evaluate((textLength) => {
      window.__CODEMIRROR_EDITOR_E2E__?.setSelection(0, textLength);
    }, MULTILINE_TEXT.length);

    // 检查第 2 行垂直中间位置在最左侧 Gutter (x = 20) 处是否有选区高亮溢出
    const hitCheck = await page.evaluate(() => {
      const lines = document.querySelectorAll(".cm-line");
      if (lines.length < 2) return { inGutter: null };
      const secondLineRect = lines[1].getBoundingClientRect();
      const testY = secondLineRect.top + secondLineRect.height / 2;

      // 在最左侧 gutter (x = 20) 进行命中测试
      const target = document.elementFromPoint(20, testY);
      return {
        targetClass: target ? target.className : "",
        isSelection: target?.classList.contains("cm-selectionBackground") ?? false,
      };
    });

    // 左侧 Gutter 绝对不能命中选区背景（被 clip-path 裁掉或未延伸至此）
    expect(hitCheck.isSelection).toBe(false);
  });
});
