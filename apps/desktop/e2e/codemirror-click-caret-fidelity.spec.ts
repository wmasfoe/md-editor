import { expect, test, type Page } from "@playwright/test";

/**
 * 点击落点保真（CM6 高度图契约）回归。
 *
 * ## 缺陷症状
 * 滚动后在段落上点击，光标落到**下一行**（`selectionHead` 比点击处多一行，`.cm-cursor`
 * 绘制在点击点下方一行）。用户可稳定复现，且与文档内容无关（纯文本同样复现）。
 *
 * ## 根因
 * CM6 的 y→行号映射完全建立在高度图上：
 * `posAtCoords` → `view.elementAtHeight(yOffset)`（`@codemirror/view` dist `function posAtCoords`）。
 * 高度图对每行/块只量 **border-box**（`getBoundingClientRect().height`），**不含 margin**。
 * 因此任何带垂直 margin 的块级行都会让高度图累计漏算；漏算量累计超过一个行高时，
 * 点击的物理 y 就被映射到更靠后的行（视觉与文档 offset 割裂）。
 *
 * 实测（修复前）：文档含 2 个 `---`（各 8px 上下 margin = 16px），漏算 32px > 行高 28px
 * ⇒ 点击段落稳定 +1 行。修复：符号型块间距由 margin 改为 padding（进 border-box），
 * 见 `packages/renderer-codemirror/src/wysiwyg/blocks/block-replacement.ts`。
 *
 * ## 为什么两条断言都要
 * 1. 「块行无垂直 margin」是**预防性**的通用护栏：新增任何块类型时若用 margin 做间距，
 *    这里会立刻失败，而不是等用户报告“点击错行”。
 * 2. 「点击落点」是**端到端**证据：它不依赖内部实现（margin/padding 都不是契约），
 *    只断言用户可见行为。
 *
 * 契约来源：`docs/agent/specs/thematic_break_and_block_inclusivity_spec.md`。
 */

const UNIT = 16;

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
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
  await expect
    .poll(async () =>
      page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()?.renderer?.markdown),
    )
    .toBe(markdown);
}

function readSelectionHead(page: Page): Promise<number | null> {
  return page.evaluate(
    () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()?.renderer?.selectionHead ?? null,
  );
}

/** 目标段落：点击点落在它上面时，光标必须落在它所在的行。 */
const TARGET = "目标段落：点击此处必须把光标放在本行内。";

/**
 * 文档：上方必须有 ≥2 个符号型块（`---`），并且足够长以产生滚动。
 * 修复前：2×16px 漏算 > 行高 ⇒ 点目标段落必 +1 行。
 */
const DOC = [
  "# 标题",
  "",
  "前言段落一。",
  "",
  "---",
  "",
  "前言段落二。",
  "",
  "---",
  "",
  ...Array.from({ length: 12 }, (_, index) => [`第 ${index + 1} 段填充内容。`, ""]).flat(),
  TARGET,
  "",
  "结尾段落。",
  "",
].join("\n");

test.describe("点击落点保真（CM6 高度图契约）", () => {
  test("块级行不得用垂直 margin 提供间距（否则高度图漏算 ⇒ 点击偏行）", async ({ page }) => {
    await openHarness(page);
    // 覆盖全部块类型：分割线（symbol）+ 表格 / HTML / MDX（content）
    await replaceDocument(
      page,
      [
        "# 块行间距契约",
        "",
        "---",
        "",
        "| 列A | 列B |",
        "| --- | --- |",
        "| 值1 | 值2 |",
        "",
        '<div class="hero"><p>Body</p></div>',
        "",
        '<Callout type="info" title="提示">',
        "body",
        "</Callout>",
        "",
        "---",
        "",
        "收尾段落。",
        "",
      ].join("\n"),
    );

    const offenders = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".cm-content > *"))
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            className: element.className.slice(0, 60),
            marginTop: Number.parseFloat(style.marginTop) || 0,
            marginBottom: Number.parseFloat(style.marginBottom) || 0,
          };
        })
        .filter((row) => row.marginTop !== 0 || row.marginBottom !== 0);
    });

    // 已知残项（**显式登记，不得静默放过**）：MDX 卡片目前用 `margin: 0.25rem 0` 提供间距，
    // 每个 MDX 块会给高度图漏算 8px。4 个以上 MDX 块（≥32px > 行高 28px）会重现「点击偏一行」。
    // 符号型块（用户实际报告的那一类）已修复为 padding；MDX 因卡片自带 border/background，
    // 改成 padding 会让间距被边框与背景包进去（视觉变化），需按「外层行容器 + 内层卡片」
    // 结构改造，属独立任务：`.omx/investigations/click-caret-offset-after-scroll.md`。
    const KNOWN_RESIDUAL = [{ className: "cm-md-mdx-widget", marginTop: 4, marginBottom: 4 }];
    const unexpected = offenders.filter(
      (row) => !KNOWN_RESIDUAL.some((known) => row.className.startsWith(known.className)),
    );

    expect(
      unexpected,
      `块级行不得用垂直 margin 提供间距（CM6 高度图只量 border-box，margin 会造成点击偏行）。` +
        `改用 padding 交付。违规行：${JSON.stringify(unexpected)}`,
    ).toEqual([]);
    // 已知残项的贡献量必须被钉死，防止它在不知不觉间变大（如从 4px 改成 12px）。
    for (const row of offenders) {
      const known = KNOWN_RESIDUAL.find((item) => row.className.startsWith(item.className));
      expect(known, `未登记的残项：${row.className}`).toBeDefined();
      expect(row.marginTop).toBeLessThanOrEqual(known?.marginTop ?? 0);
      expect(row.marginBottom).toBeLessThanOrEqual(known?.marginBottom ?? 0);
    }
  });

  test("滚动后点击段落，光标必须落在被点击的行内（修复前 +1 行）", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, DOC);

    // 目标段落与其上方内容必须产生滚动（缺陷只在“点击行之上有未测量区域”时显现）。
    await page.getByText(TARGET, { exact: false }).first().scrollIntoViewIfNeeded();
    await expect
      .poll(async () => page.evaluate(() => document.querySelector(".cm-scroller")?.scrollTop ?? 0))
      .toBeGreaterThan(0);

    const expectedLine = DOC.slice(0, DOC.indexOf(TARGET)).split("\n").length;
    const target = page.getByText(TARGET, { exact: false }).first();
    const box = await target.boundingBox();
    expect(box, "目标段落必须可见").not.toBeNull();
    if (!box) {
      return;
    }
    // 点在段落的竖直中线（用户点文字的自然位置）
    await page.mouse.click(box.x + UNIT, box.y + box.height / 2);

    const head = await readSelectionHead(page);
    expect(head).not.toBeNull();
    const markdown = await page.evaluate(
      () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()?.renderer?.markdown ?? "",
    );
    const actualLine = markdown.slice(0, head ?? 0).split("\n").length;
    expect(actualLine, `点击位置与光标落点必须在同一行（期望第${expectedLine}行）`).toBe(
      expectedLine,
    );

    // 视觉证据：光标必须绘制在被点击段落的盒内，而不是下一行。
    const cursorY = await page.evaluate(
      () => document.querySelector(".cm-cursor")?.getBoundingClientRect().y ?? null,
    );
    expect(cursorY).not.toBeNull();
    if (cursorY === null) {
      return;
    }
    expect(cursorY).toBeGreaterThanOrEqual(box.y - 2);
    expect(cursorY).toBeLessThanOrEqual(box.y + box.height + 2);
  });
});
