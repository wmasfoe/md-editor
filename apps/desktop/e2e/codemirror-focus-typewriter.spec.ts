import { expect, test, type Page } from "@playwright/test";
import { openFullApp as openApp, loadDoc, runCommand, setCaret } from "./editor-e2e-helpers";

/**
 * E13–E15：D-2 专注模式 / 打字机模式 的 desktop Playwright E2E（test-spec §3）。
 *
 *  - E13 / F2+F1：活动块标记（光标所在 block）+ dim 强度落在 0.30–0.50（默认 0.38）
 *  - E14 / F5    ：原子 widget（表格）在专注模式下**不消失**（F-C 根 class 机制的正面证据）
 *  - E15 / W1+W2 ：打字机阈值防抖（≤0.35×视口高不滚动）+ 超阈值校正到 50%
 *  - E15 / W3    ：输入路径**即时**跟随（禁 smooth —— 单次大输入后短窗内光标即居中）
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
});
