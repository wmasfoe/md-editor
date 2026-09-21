/**
 * 代码块结构缩进（WYSIWYG）：正文去缩进 + 列表子项卡片右移 + 复制一致性。
 *
 * 规则：结构性缩进（围栏自身 1~3 空格缩进、容器缩进）不进代码正文显示；
 * 卡片是否整体右移由容器决定（列表/任务子项右移，顶层缩进围栏不右移）。
 */
import { expect, test, type Page } from "@playwright/test";

const DOC = [
  "- 一级 item",
  "",
  "  我是子项段落（前面 2 空格）",
  "",
  "  ```js",
  "  console.log(123);",
  "  ```",
  "",
  "- 一级 item2",
  "",
  "  ```js",
  "    console.log(456);",
  "  ```",
  "",
  "结束列表的段落",
  "",
  "  ```ts",
  "  const indented = 1;",
  "  ```",
  "",
  "```ts",
  "const plain = 1;",
  "```",
  "",
].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()))
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

test.describe("code block structural indent", () => {
  test("shifts container-nested cards by the container indent and keeps the code text in place", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openHarness(page);
    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, DOC);
    await expect(page.locator(".cm-md-code-line").first()).toBeVisible();

    const report = await page.evaluate(() => {
      // page.evaluate 只序列化本回调自身的源码，工具函数必须内联定义（提到模块作用域会在浏览器里
      // 变成未定义），因此这里对 consistent-function-scoping 做定点豁免。
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const round = (value: number) => Math.round(value * 100) / 100;
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const textLeft = (line: HTMLElement): number => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const length = node.textContent?.length ?? 0;
          if (length > 0) {
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, length);
            return range.getBoundingClientRect().left;
          }
          node = walker.nextNode();
        }
        return Number.NaN;
      };
      const lines = [...document.querySelectorAll<HTMLElement>(".cm-md-code-line")];
      const first = lines[0];
      /** 代码行等宽字体下 1ch 即一个空格宽度，卡片右移量必须正好等于结构缩进的空格数。 */
      const probe = document.createElement("span");
      const firstStyle = getComputedStyle(first);
      probe.style.fontFamily = firstStyle.fontFamily;
      probe.style.fontSize = firstStyle.fontSize;
      probe.style.position = "absolute";
      probe.style.whiteSpace = "pre";
      probe.style.visibility = "hidden";
      probe.textContent = "0000000000";
      document.body.append(probe);
      const monoCh = probe.getBoundingClientRect().width / 10;
      probe.remove();

      const describe = (line: HTMLElement | undefined) => {
        if (!line) return null;
        const rect = line.getBoundingClientRect();
        const style = getComputedStyle(line);
        const toolbarRow = document.querySelector<HTMLElement>(".cm-md-code-toolbar-row");
        return {
          text: line.textContent ?? "",
          cardLeft: round(rect.left),
          cardWidth: round(rect.width),
          codeTextLeft: round(textLeft(line)),
          paddingInlineStart: round(Number.parseFloat(style.paddingInlineStart)),
          borderLeftWidth: round(Number.parseFloat(style.borderLeftWidth)),
          marginInlineStart: round(Number.parseFloat(style.marginInlineStart)),
          toolbarLeft: toolbarRow ? round(toolbarRow.getBoundingClientRect().left) : null,
          toolbarHeight: toolbarRow ? round(toolbarRow.getBoundingClientRect().height) : null,
        };
      };
      const toolbarRows = [...document.querySelectorAll<HTMLElement>(".cm-md-code-toolbar-row")];
      const toolbarHeights = toolbarRows.map((row) => round(row.getBoundingClientRect().height));
      const gap =
        toolbarRows[0] && first
          ? round(first.getBoundingClientRect().top - toolbarRows[0].getBoundingClientRect().bottom)
          : null;
      return {
        monoCh: round(monoCh),
        plain: describe(lines[3]),
        listChildIndent2: describe(lines[0]),
        listChildIndent4: describe(lines[1]),
        topLevelIndent2: describe(lines[2]),
        toolbarHeights,
        toolbarToBodyGap: gap,
      };
    });

    const { monoCh } = report;
    // 列表子项：卡片右移 2 个空格宽度，代码文字落在卡片内边距起点上。
    expect(report.listChildIndent2?.marginInlineStart).toBeCloseTo(2 * monoCh, 1);
    expect(report.listChildIndent2?.cardLeft).toBeCloseTo(
      (report.plain?.cardLeft ?? Number.NaN) + 2 * monoCh,
      1,
    );
    expect(report.listChildIndent2?.codeTextLeft).toBeCloseTo(
      (report.listChildIndent2?.cardLeft ?? Number.NaN) +
        (report.listChildIndent2?.borderLeftWidth ?? Number.NaN) +
        (report.listChildIndent2?.paddingInlineStart ?? Number.NaN),
      1,
    );
    // 工具栏与卡片左缘一致，两者之间没有断层。
    expect(report.listChildIndent2?.toolbarLeft).toBeCloseTo(
      report.listChildIndent2?.cardLeft ?? Number.NaN,
      1,
    );
    expect(report.toolbarToBodyGap).toBe(0);
    // 工具栏高度不受缩进影响（同一文档内各代码块一致）。
    expect(new Set(report.toolbarHeights).size).toBe(1);

    // 顶层缩进围栏：只去缩进，卡片不右移。
    expect(report.topLevelIndent2?.marginInlineStart).toBe(0);
    expect(report.topLevelIndent2?.cardLeft).toBeCloseTo(report.plain?.cardLeft ?? Number.NaN, 1);

    // 代码内容自身的缩进保留：容器缩进 2 列 + 内容缩进 2 列 → 可见文本以 2 个空格开头。
    expect(report.listChildIndent4?.text).toBe("  console.log(456);");
  });

  test("copies the code body without the structural indent", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openHarness(page);
    await page.evaluate((markdown) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    }, DOC);
    const toolbar = page.locator(".cm-md-code-toolbar").first();
    await toolbar.locator(".cm-md-code-toolbar__copy").click();
    await expect(toolbar.locator(".cm-md-code-toolbar__status")).toHaveText("Copied");
    await expect
      .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getCopiedText()))
      .toEqual(["console.log(123);\n"]);
  });
});
