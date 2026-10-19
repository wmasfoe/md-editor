import { expect, test, type Page } from "@playwright/test";

/**
 * WYSIWYG 块间空行保真（CM6 块级替换 Inclusivity 契约）回归。
 *
 * 症状：源码 `## 标题` + 1 个空行 + 表格 / HTML 块 / MDX 块时，编辑区渲染出 **2 个空行**。
 * 根因：整行块级替换装饰写了 `inclusive: false`，CM6 view builder 判定起点未覆盖，
 * 调用 `b.addLineStartIfNotCovered()` 在 widget 上方**合成幽灵行**。
 * 契约见 `docs/agent/specs/thematic_break_and_block_inclusivity_spec.md`。
 */

const HEADING = "## 1. 竞品概况";

interface BlockCase {
  readonly name: string;
  /** widget 根节点的 DOM class（块替换后成为 `.cm-content` 的直接子节点）。 */
  readonly widgetClass: string;
  /** 块自身的源码行（不含与标题之间的空行）。 */
  readonly body: readonly string[];
}

const TABLE_CASE: BlockCase = {
  name: "table",
  widgetClass: "cm-md-table-widget",
  body: ["| 维度 | VMark | Inkpoint（本项目） |", "| --- | --- | --- |", "| 开源 | 是 | 是 |"],
};

const THEMATIC_BREAK_CASE: BlockCase = {
  name: "thematic-break",
  widgetClass: "cm-md-thematic-break-widget",
  body: ["---"],
};

const HTML_CASE: BlockCase = {
  name: "html",
  widgetClass: "cm-md-html-block-widget",
  body: ['<div class="hero"><p>Body</p></div>'],
};

const MDX_CASE: BlockCase = {
  name: "mdx",
  widgetClass: "cm-md-mdx-widget",
  body: ['<Callout type="info" title="提示">', "body", "</Callout>"],
};

const BLOCK_CASES: readonly BlockCase[] = [TABLE_CASE, HTML_CASE, MDX_CASE, THEMATIC_BREAK_CASE];
// 注：mermaid 不在本表——本 spec 的 harness（`?surface=codemirror-editor&mdx=1`）**未启用 mermaid 插件**，
// 因此 ```mermaid 在本夹具下只会是普通代码块（widget 计数永远为 0）。
// mermaid 的同一套空行保真断言改在启用插件的完整 app harness 中断言：
// apps/desktop/e2e/codemirror-mermaid-viewer.spec.ts 的「块间空行保真」用例。

/** 空行档位：0（紧贴，块级替换不得吞掉整行语义）与 1（用户报告的故障场景）。 */
const BLANK_COUNTS = [0, 1] as const;

function markdownFor(blockCase: BlockCase, blankCount: number): string {
  const blanks = Array.from({ length: blankCount }, () => "");
  return [HEADING, ...blanks, ...blockCase.body, ""].join("\n");
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  // 冷启动时 Vite 需要按需转译整个渲染器依赖图（本地实测可超过数秒），
  // 因此这里用显式长超时等待桥接与 CM 视图就绪，而不是默认 5s。
  await expect(page.locator(".cm-editor")).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()), {
      timeout: 30_000,
    })
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

async function replaceDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((nextMarkdown) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(nextMarkdown, "wysiwyg");
  }, markdown);
  await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const harness = window.__CODEMIRROR_EDITOR_E2E__;
    if (!harness) throw new Error("CodeMirror editor harness is unavailable.");
    return harness.getDiagnostics();
  });
}

async function contentChildren(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cm-content > *")).map((element) => element.className),
  );
}

function hasClass(className: string, expected: string): boolean {
  return className.split(/\s+/u).includes(expected);
}

test.describe("WYSIWYG 块间空行保真（标题 ↔ 块级 widget）", () => {
  // 每个用例都要冷启一个新页面并等待渲染器就绪；默认 30s 在慢盘/冷 Vite 下不够稳定。
  test.describe.configure({ timeout: 90_000 });

  for (const blockCase of BLOCK_CASES) {
    for (const blankCount of BLANK_COUNTS) {
      test(`${blockCase.name}: 源码 ${blankCount} 个空行 ⇒ 视觉 ${blankCount} 个空行`, async ({
        page,
      }) => {
        await openHarness(page);
        await replaceDocument(page, markdownFor(blockCase, blankCount));
        await expect(page.locator(`.${blockCase.widgetClass}`)).toHaveCount(1);

        const children = await contentChildren(page);
        const widgetIndex = children.findIndex((className) =>
          hasClass(className, blockCase.widgetClass),
        );
        expect(widgetIndex).toBeGreaterThan(0);
        expect(hasClass(children[0], "cm-md-heading")).toBe(true);

        const between = children.slice(1, widgetIndex);
        // 块级 widget 与标题之间的每个可视行都必须是真实 `.cm-line`；
        // 幽灵行会让这里多出行，源码 1 个空行被渲染成 2 个空行。
        expect(between.every((className) => hasClass(className, "cm-line"))).toBe(true);
        expect(between).toHaveLength(blankCount);
      });
    }
  }

  test("段落对照:源码 1 个空行 ⇒ 视觉 1 个空行", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, [HEADING, "", "普通段落", ""].join("\n"));

    const children = await contentChildren(page);
    // 标题行 + 空行 + 段落行 + 文末空行
    expect(children).toHaveLength(4);
    expect(children.every((className) => hasClass(className, "cm-line"))).toBe(true);

    const emptyLines = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".cm-content > .cm-line"))
        .filter((element) => (element.textContent ?? "") === "")
        .map((element) => element.className),
    );
    // 只有标题下方那一个空行 + 文末空行，没有被合成出来的多余行。
    expect(emptyLines).toEqual(["cm-line", "cm-line"]);
  });

  test("方向键进入整块原子时光标不落在已消失的幽灵空行上", async ({ page }) => {
    await openHarness(page);
    const markdown = markdownFor(TABLE_CASE, 1);
    await replaceDocument(page, markdown);

    const widget = page.locator(`.${TABLE_CASE.widgetClass}`);
    await expect(widget).toHaveCount(1);

    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(0, 0));
    // 标题行 → 1 个空行 → 进入整表原子：恰好 2 次 ArrowDown。
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(widget).toHaveAttribute("aria-selected", "true");

    const tableFrom = markdown.indexOf(TABLE_CASE.body[0]);
    const tableTo = tableFrom + TABLE_CASE.body.join("\n").length;
    const diag = await diagnostics(page);
    expect(diag.renderer).toMatchObject({ selectionAnchor: tableFrom, selectionHead: tableTo });

    // 原子选中态下光标必须画在表格上方之外（幽灵空行会让它上浮到表格顶边之上）。
    await expect
      .poll(
        () =>
          page.evaluate((selector) => {
            const cursor = document.querySelector(".cm-cursor");
            const target = document.querySelector(selector);
            if (!cursor || !target) return false;
            return cursor.getBoundingClientRect().bottom < target.getBoundingClientRect().top;
          }, `.${TABLE_CASE.widgetClass}`),
        { timeout: 2000, intervals: [50, 50, 100] },
      )
      .toBe(false);

    // 再按一次 ArrowDown 离开整表，光标回落到表格记录末端（与分割线同一契约：
    // 向下离开整块原子时折叠到 `record.fullRange.to`）。
    await page.keyboard.press("ArrowDown");
    await expect(widget).toHaveAttribute("aria-selected", "false");
    const after = await diagnostics(page);
    expect(after.renderer?.selectionHead).toBe(tableTo);
  });

  for (const blockCase of [TABLE_CASE, HTML_CASE, MDX_CASE]) {
    test(`${blockCase.name}: 整块原子选中态键入逐字追加，不得丢首字符`, async ({ page }) => {
      await openHarness(page);
      await replaceDocument(page, markdownFor(blockCase, 1));
      const widget = page.locator(`.${blockCase.widgetClass}`);
      await expect(widget).toHaveCount(1);

      await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(0, 0));
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(widget).toHaveAttribute("aria-selected", "true");

      // 契约：键入 = 替换整块 + 光标收敛；后续字符必须追加而非覆盖前一字符。
      await page.keyboard.type("ab");
      await expect
        .poll(async () => (await diagnostics(page)).renderer?.markdown)
        .toBe([HEADING, "", "ab", ""].join("\n"));
      await expect(widget).toHaveCount(0);
    });
  }

  test("行内 JSX：不丢内容且不产生额外空行", async ({ page }) => {
    await openHarness(page);
    // 行内 JSX 的“块级化排版”（widget 自占一行）是既有行为，本用例只守住两条底线：
    // 1. 前后文本不得丢失或与 widget 粘连；
    // 2. 不得因块级替换而合成幽灵空行（源码无空行 ⇒ 无空 `.cm-line`）。
    // 注意：此处刻意不写尾换行，否则源码末尾那个空行会被错误地当作“幽灵空行”。
    await replaceDocument(page, "前言 <Callout>x</Callout> 后记");
    await expect(page.locator(".cm-md-mdx-widget")).toHaveCount(1);

    const contentText = await page.evaluate(
      () => document.querySelector(".cm-content")?.textContent ?? "",
    );
    expect(contentText).toContain("前言");
    expect(contentText).toContain("后记");

    const emptyLines = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll(".cm-content > .cm-line")).filter(
          (element) => (element.textContent ?? "") === "",
        ).length,
    );
    expect(emptyLines).toBe(0);
  });

  test("符号型块（分割线）由统一规则提供默认间距且不引入幽灵空行", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, markdownFor(THEMATIC_BREAK_CASE, 0));

    const metrics = await page.evaluate(() => {
      const widget = document.querySelector(".cm-md-thematic-break-widget");
      if (!(widget instanceof HTMLElement)) return null;
      const style = getComputedStyle(widget);
      return {
        category: widget.getAttribute("data-md-block-category"),
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
      };
    });

    expect(metrics?.category).toBe("symbol");
    // 规则：间距 = `--theme-block-symbol-gap`（缺失时回落到 0.5rem，DESIGN.md 4px 基线网格）。
    const expectedGap = 0.5 * Number.parseFloat(metrics!.rootFontSize);
    expect(Number.parseFloat(metrics!.marginTop)).toBeCloseTo(expectedGap, 1);
    expect(Number.parseFloat(metrics!.marginBottom)).toBeCloseTo(expectedGap, 1);
  });
});
