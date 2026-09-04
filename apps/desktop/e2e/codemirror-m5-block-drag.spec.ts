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

test.describe("块布局与排版同构", () => {
  test("B1: 普通段落行首不挂载冗余工具栏节点(保持零 DOM 污染与纯粹排版)", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, FIXTURE);

    // 普通段落行首无冗余 block-toolbar widget
    const toolbars = page.locator(".cm-md-block-toolbar");
    await expect(toolbars).toHaveCount(0);
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
});
