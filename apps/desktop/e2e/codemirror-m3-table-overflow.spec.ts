import { expect, test, type Page } from "@playwright/test";

/**
 * 表格横向溢出回归（用户报告：编辑区出现横向滚动条）。
 *
 * 症状：含表格的文档在编辑区出现**页面级**横向滚动条，表格右侧内容被裁掉。
 * 根因：`.cm-md-table-widget__grid` 曾用 `width: max-content` 按最宽单元格撑开表格，
 * 而 `.cm-md-table-widget` 的 `max-width: 100%` 只约束 wrapper 自身盒模型、
 * 不约束 table 子元素的溢出 —— 溢出直接穿透到 `.cm-scroller`（`overflow: auto`）。
 *
 * 现行契约（混合策略）：
 * 1. 表格默认 `width: 100%` 撑满正文列，列宽按内容比例分配，长文本单元格内换行
 *    ⇒ 常规表格不需要任何横向滚动；
 * 2. 列数过多时单元格有可读下限，表格 min-content 撑破容器，由内层
 *    `.cm-md-table-widget__viewport` 承接横向滚动（`.cm-scroller` 永不出横向滚动条）；
 * 3. 行/列手柄与列宽拖动手柄在任何状态下都必须可点（不被滚动盒裁掉、不互相遮挡）。
 */

/** 构造 n 列表格；`cellText` 决定每格内容宽度。 */
function makeTable(cols: number, cellText: (row: number, col: number) => string): string {
  const header = `| ${Array.from({ length: cols }, (_, i) => `列 ${i + 1}`).join(" | ")} |`;
  const delimiter = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const rows = [0, 1].map(
    (row) => `| ${Array.from({ length: cols }, (_, col) => cellText(row, col)).join(" | ")} |`,
  );
  return [header, delimiter, ...rows, ""].join("\n");
}

/** 用户报告的原始表格（3 列，长中文文本 + 行内代码）。 */
const REPORTED_TABLE = [
  "### 常用渲染策略（`renderPolicy`）说明",
  "",
  "| `renderPolicy` | 适用场景 | 交互表现 |",
  "| :--- | :--- | :--- |",
  '| `"directive-panel"` | 块级卡片、提示面板（如 `:::info`、Alerts） | 首行替换为精美标签栏卡片头，正文可编辑，光标离开自动收起标记 |',
  '| `"inline-visible-markers"` | 行内强化标记（如高亮标记 `==text==`） | 处于光标所在行时光标可见标记符号，光标离开时光标隐藏符号只留高亮 |',
  '| `"source-only-atom"` | 复杂原子级块（如数学公式块） | 整体作为一个不可拆分原子，双击或聚焦进入源码编辑 |',
  "",
  "---",
  "",
  "## 三、实战开发示例",
  "",
].join("\n");

async function loadDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate(
    (source) => window.__MD_EDITOR_E2E__!.replaceDocument(source, "/fixtures/table-overflow.md"),
    markdown,
  );
  await expect(page.locator(".cm-md-table-widget")).toHaveCount(1);
  // 溢出状态由 ResizeObserver 异步写入，等它稳定再断言。
  await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
    "data-table-overflow",
    /^(?:true|false)$/u,
  );
}

/** 编辑区（`.cm-scroller`）是否出现页面级横向滚动。 */
async function pageScrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) throw new Error("missing .cm-scroller");
    return scroller.scrollWidth > scroller.clientWidth;
  });
}

/** 表格是否在自身视口内横向滚动。 */
async function tableScrollsLocally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".cm-md-table-widget__viewport");
    const grid = document.querySelector<HTMLElement>(".cm-md-table-widget__grid");
    if (!viewport || !grid) throw new Error("missing table viewport/grid");
    // 不能用 viewport.scrollWidth：列宽拖动手柄（right: -3px）永远溢出表格 2px，
    // 会让每张表都被判为“可滚动”。表格自身的布局宽度才是真正的溢出信号。
    return Math.round(grid.offsetWidth) > Math.round(viewport.clientWidth) + 1;
  });
}

/** 探测某个元素中心点命中的元素 class（验证热区没有被别的元素盖住）。
 *
 * 手柄的外层容器（如 `.cm-md-table-widget__handle--row`）只是定位锚点，真正可点的是
 * 内部的 `__btn` 按钮；命中后若是容器或其内部按钮都算「手柄可点」。
 */
async function hitClassAt(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((target) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return "invisible";
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit?.className?.toString() ?? null;
  }, selector);
}

/** 命中元素是否属于某个 widget 交互控件（容器或内部按钮）。 */
function isTableControl(hit: string | null, className: string): boolean {
  return Boolean(hit?.split(/\s+/u).includes(className));
}

test.describe("表格横向溢出（编辑区不得出现页面级横向滚动条）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#welcome-title")).toBeVisible();
  });

  test("用户报告的 3 列表格：自适应压缩，无任何横向滚动", async ({ page }) => {
    await loadDocument(page, REPORTED_TABLE);

    // 混合策略的常规路径：撑满正文列 + 单元格内换行 ⇒ 不需要滚动。
    await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
      "data-table-overflow",
      "false",
    );
    expect(await pageScrollsHorizontally(page)).toBe(false);
    expect(await tableScrollsLocally(page)).toBe(false);

    // 表格右缘必须落在编辑区内容区之内（这正是原缺陷：右缘越界 144px）。
    const geometry = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
      const content = document.querySelector<HTMLElement>(".cm-content")!;
      const wrapper = document.querySelector<HTMLElement>(".cm-md-table-widget")!;
      const style = getComputedStyle(content);
      return {
        wrapperRight: wrapper.getBoundingClientRect().right,
        scrollerRight: scroller.getBoundingClientRect().right,
        contentRight:
          content.getBoundingClientRect().right - Number.parseFloat(style.paddingRight || "0"),
      };
    });
    expect(geometry.wrapperRight).toBeLessThanOrEqual(geometry.scrollerRight + 1);
    expect(geometry.wrapperRight).toBeLessThanOrEqual(geometry.contentRight + 1);

    // 非溢出态：手柄仍贴在表格外侧且可点（滚动盒不得建立裁剪）。
    // 手柄容器是定位锚点，命中其内部按钮即算可点。
    expect(
      isTableControl(
        await hitClassAt(page, ".cm-md-table-widget__handle--row"),
        "cm-md-table-widget__btn--handle",
      ),
    ).toBe(true);
    expect(
      isTableControl(
        await hitClassAt(page, "thead th:last-child .cm-md-table-widget__handle--col"),
        "cm-md-table-widget__btn--handle",
      ),
    ).toBe(true);
  });

  test("列数过多的表格：只在表格块内滚动，且手柄与列宽拖拽仍可点", async ({ page }) => {
    await loadDocument(
      page,
      makeTable(16, (row, col) => `c${row}${col}`),
    );

    await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
      "data-table-overflow",
      "true",
    );
    expect(await pageScrollsHorizontally(page)).toBe(false);
    expect(await tableScrollsLocally(page)).toBe(true);

    // 溢出态下手柄移回单元格内缘，否则会被滚动盒裁掉（elementFromPoint 落到 .cm-content）。
    expect(
      isTableControl(
        await hitClassAt(page, ".cm-md-table-widget__handle--row"),
        "cm-md-table-widget__btn--handle",
      ),
    ).toBe(true);

    // 列宽拖动手柄不得被列操作手柄遮挡（历史缺陷：right:-0.65rem 的列手柄整个盖住它）。
    expect(
      isTableControl(
        await hitClassAt(page, "thead th:first-child .cm-md-table-widget__resize-grip"),
        "cm-md-table-widget__resize-grip",
      ),
    ).toBe(true);
  });

  test("列宽拖拽在自适应布局下生效，且不写入源码", async ({ page }) => {
    const markdown = makeTable(3, (row, col) => `内容 ${row}-${col}`);
    await loadDocument(page, markdown);

    const header = page.locator('th[data-row-kind="header"][data-col-index="0"]');
    const grip = header.locator(".cm-md-table-widget__resize-grip");
    const before = (await header.boundingBox())!.width;
    const gripBox = (await grip.boundingBox())!;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2 + 40, gripBox.y + gripBox.height / 2, {
      steps: 6,
    });
    await page.mouse.up();

    await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 20);
    // 列宽是纯展示状态：Markdown 无列宽语法，源码必须逐字节不变。
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics())).renderer
            ?.markdown,
      )
      .toBe(markdown);
  });

  test("容器变窄后表格从自适应切换为本地滚动，编辑区仍不出横向滚动条", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // 8 列：1280 宽下能压缩进容器（无滚动），620 宽下「列数 × 可读下限」挤不下。
    // 实测临界点：6/8/10 列在 1280 与 900 下均不溢出，12 列已溢出；8 列在 620 下溢出。
    await loadDocument(
      page,
      makeTable(8, (row, col) => `c${row}${col}`),
    );
    await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
      "data-table-overflow",
      "false",
    );

    await page.setViewportSize({ width: 620, height: 900 });
    await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
      "data-table-overflow",
      "true",
    );
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });

  test("窄表格不产生滚动条与滚动阴影（状态切换不得误判）", async ({ page }) => {
    await loadDocument(
      page,
      makeTable(2, (row, col) => `${row}${col}`),
    );

    await expect(page.locator(".cm-md-table-widget")).toHaveAttribute(
      "data-table-overflow",
      "false",
    );
    expect(await pageScrollsHorizontally(page)).toBe(false);
    expect(await tableScrollsLocally(page)).toBe(false);
  });
});
