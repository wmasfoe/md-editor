import { expect, test, type Page } from "@playwright/test";
import { openFullApp as openApp, loadDoc, runCommand, setCaret } from "./editor-e2e-helpers";

/**
 * E13–E15：D-2 专注模式 / 打字机模式 的 desktop Playwright E2E（test-spec §3）。
 *
 *  - E13 / F2+F1：活动块标记（光标所在 block）+ dim 强度落在 0.30–0.50（默认 0.38）
 *  - E14 / F5    ：原子 widget（表格）在专注模式下**不消失**（F-C 根 class 机制的正面证据）
 *  - E15 / W1+W2 ：打字机阈值防抖（≤0.35×视口高不滚动）+ 超阈值校正到 50%
 *  - E15 / W3    ：输入路径**即时**跟随（禁 smooth —— 单次大输入后短窗内光标即居中）
 *  - E20 / 所有权 ：开启专注后**移动光标**，非活动块仍保持 dim（HIGH-1 回归锁）
 *  - E21 / F5    ：非 `ATOMIC_WIDGET_KINDS` 的整块 widget（setext/引用定义/脚注定义/表格）
 *                  在专注模式下不消失、不产生幻影行（块级 DOM 结构不变量）
 *
 * 两个模式均经 **G007 命令面板**触发（AC-D2-2 顺带取证：命令面板可搜可执行）。
 * F3（搜索命中对比度）按 §4 降级、W4 显式延期、W5 拆半（滚动校正在本文件 W1/W2 覆盖）。
 */

const FOCUS_DOC = [
  "# 标题块",
  "",
  "段落甲是活动块测试目标。",
  "",
  "段落乙是 dim 测试目标，它在活动块之外，专注模式下应被压暗。",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
  ...Array.from(
    { length: 30 },
    (_, i) => `滚动段落 ${i + 1}：打字机校正与专注模式 E2E 的长文本占位内容。`,
  ),
  "",
].join("\n");

/** E21 夹具：四种整块 replace widget，其中三种**不在** `ATOMIC_WIDGET_KINDS` 名单内 */
const WIDGET_DOC = [
  "Setext 标题",
  "===========",
  "",
  "普通段落，专注模式下应被 dim。",
  "",
  "[ref]: https://example.com/only",
  "",
  "脚注引用示例。[^1]",
  "",
  "[^1]: 脚注定义内容",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
].join("\n");

/** contentDOM 的块级结构快照（行 / 非行子元素）——「专注模式不得改变块级 DOM 结构」不变量的观测量 */
function blockStructure(page: Page): Promise<{ total: number; lines: number; widgets: number }> {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    if (!content) {
      return { total: -1, lines: -1, widgets: -1 };
    }
    const children = Array.from(content.children);
    return {
      total: children.length,
      lines: children.filter((element) => element.classList.contains("cm-line")).length,
      widgets: children.filter((element) => !element.classList.contains("cm-line")).length,
    };
  });
}

/** 光标与视口中心的偏差（按 scroller 高度归一化）；光标不可见时返回 999 */
function cursorCenterDelta(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const scroller = document.querySelector(".cm-scroller")?.getBoundingClientRect();
    if (!cursor || !scroller || scroller.height === 0) {
      return 999;
    }
    return (
      Math.abs(cursor.top + cursor.height / 2 - (scroller.top + scroller.height / 2)) /
      scroller.height
    );
  });
}

test.describe("D-2 专注模式 / 打字机模式（真实 desktop app）", () => {
  test("E13/F2+F1：活动块标记 = 光标所在块；dim 强度落在 0.30–0.50", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    // AC-D2-2 顺带取证：命令面板触发（G007 注册面）
    await runCommand(page, "Focus Mode");

    await expect(page.locator(".cm-md-focus-mode"), "root 标记开启").toHaveCount(1);
    const active = page.locator(".cm-md-focus-active");
    await expect(active, "F2：恰有一个活动块").toHaveCount(1);
    await expect(active, "F2：活动块 = 光标所在块").toContainText("段落甲");

    const dimmed = page.locator(".cm-md-focus-dim").filter({ hasText: "段落乙" }).first();
    await expect(dimmed, "非活动块被 dim 类标记").toHaveCount(1);
    // 120ms 过渡 → 双边界同在一次 poll 内判（先降过 0.5 上限再读会撞过渡中值 0.636 的教训）
    await expect
      .poll(() => dimmed.evaluate((el) => Number(getComputedStyle(el).opacity)), {
        timeout: 2000,
        intervals: [60, 60, 60, 60],
      })
      .toBeLessThanOrEqual(0.5);
    const opacity = await dimmed.evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity, "F1 下限 0.30（默认 0.38）").toBeGreaterThanOrEqual(0.3);
  });

  test("E14/F5：专注模式下原子表格 widget 不消失（根 class 机制）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    await runCommand(page, "Focus Mode");

    const table = page.locator(".cm-md-table-widget");
    await expect(table, "F5/I10：原子 widget 块不得消失").toHaveCount(1);
    await expect(table).toBeVisible();
    // 原子根承载 focus class（ViewPlugin 切换 widget 根，而非外来 decoration 覆盖）
    await expect(table).toHaveClass(/cm-md-focus-(active|dim)/);
  });

  test("E15/W1+W2：超阈值校正到 50% 居中；阈值内不滚动", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");

    // W2：光标跳到文末段（远超 0.35×视口高）→ 校正到视口 50%
    // 容差 0.18：末采样含单帧时序抖动；未校正时偏差 ≈0.4–0.5，故 0.18 足以判别 W2 生效
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 30"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // W1：光标移到紧邻上一段（偏差 ≈1–2 行 << 0.35×视口高）→ 不滚动
    const scrollTopBefore = await page.evaluate(
      () => document.querySelector(".cm-scroller")!.scrollTop,
    );
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 29"));
    await page.waitForTimeout(700); // 防抖 + rAF 窗口
    const scrollTopAfter = await page.evaluate(
      () => document.querySelector(".cm-scroller")!.scrollTop,
    );
    expect(scrollTopAfter, "W1：阈值内不得触发滚动").toBe(scrollTopBefore);
    // 校正确实没有在等待期间被偷偷执行（光标仍大致居中）
    expect(await cursorCenterDelta(page)).toBeLessThan(0.45);
  });

  test("E15/W3：输入路径即时跟随（禁 smooth —— 大输入后短窗内光标即居中）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 30"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // 单次大输入：光标瞬间远离中心（>>0.35×vh）→ 输入路径 immediate 校正必须**即时完成**。
    // 若实现回退成 smooth，首个采样点（~30ms）光标仍会远偏离中心 → poll 早期失败。
    await page.keyboard.insertText("触发输入期即时校正的长文本内容".repeat(60));
    await expect
      .poll(() => cursorCenterDelta(page), { timeout: 350, intervals: [30, 40, 50] })
      .toBeLessThan(0.15);
  });

  test("E20/所有权契约：开启专注后移动光标，非活动块仍保持 dim（HIGH-1 回归锁）", async ({
    page,
  }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    await runCommand(page, "Focus Mode");

    const heading = page.locator(".cm-md-focus-dim").filter({ hasText: "标题块" }).first();
    await expect(heading, "开启后非活动标题块应被 dim").toHaveCount(1);

    // 关键步骤：移动光标 = 仅 selection 变化的一次更新（ViewPlugin.apply() 会重跑）。
    // 修复前该分支对**普通行**也 remove() 装饰集写下的 cm-md-focus-dim/active，
    // 而 CM 的 tile attrs 不会重放 → 非活动块整片静默失去压暗（HIGH-1）。
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".cm-md-focus-active"), "活动块应迁移到段落乙").toContainText(
      "段落乙",
    );

    await expect(heading, "HIGH-1：光标移动后非活动块不得丢失 dim 类").toHaveCount(1);
    await expect
      .poll(() => heading.evaluate((el) => Number(getComputedStyle(el).opacity)), {
        timeout: 2000,
        intervals: [60, 60, 60, 60],
      })
      .toBeLessThanOrEqual(0.5);
  });

  test("E21/F5：整块 widget（setext/引用定义/脚注定义/表格）不消失且无幻影行", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, WIDGET_DOC);
    await setCaret(page, WIDGET_DOC.indexOf("普通段落"));

    const before = await blockStructure(page);
    expect(
      before.widgets,
      "基线：至少 4 个整块 widget（setext 标题 / 引用定义 / 脚注定义 / 表格）",
    ).toBeGreaterThanOrEqual(4);

    await runCommand(page, "Focus Mode");
    await expect(page.locator(".cm-md-focus-mode")).toHaveCount(1);

    // 不变量：开启专注模式**不得**改变块级 DOM 结构 —— 既不多出行（幻影行），也不丢 widget。
    // 该断言直接否定「同位置线装饰 + block widget 共存」导致的 addLineStartIfNotCovered 现象。
    const after = await blockStructure(page);
    expect(after, "F5：专注模式不得改变块级 DOM 结构").toEqual(before);

    // 整块 widget 仍可见，且根元素承载 focus 类（dim 由 widget 根类承担）
    await expect(page.locator(".cm-md-table-widget")).toBeVisible();
    const blockAtoms = page.locator(".cm-md-default-atom--block");
    expect(
      await blockAtoms.count(),
      "setext 标题 / 引用定义 / 脚注定义 = 3 个 block 形态 default atom",
    ).toBeGreaterThanOrEqual(3);
    for (const widget of await blockAtoms.all()) {
      await expect(widget).toHaveClass(/cm-md-focus-(active|dim)/);
    }
  });
});
