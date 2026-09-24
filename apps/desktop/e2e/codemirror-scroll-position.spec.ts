import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { openFullApp as openApp, loadDoc } from "./editor-e2e-helpers";

/**
 * S7 / E34：**「滚动后突然弹回顶部」** 的复现与回归锁。
 *
 * 夹具 = 属主复现文档 `/Users/ikun/Documents/md/111/demo-00-README-演示手册.md` 的**逐字副本**
 *（随仓库提交以保证 CI 可跑；内容未做任何改写）。
 * 核对方式（code-reviewer 复审 LOW-5 要求「证实或软化」）：`diff` 原文件与夹具 = **IDENTICAL**，
 * 两者 sha256 同为 `061222594167cfdb…`、均为 **6353 字节**（2026-09-24 复核）。
 *
 * 根因（实测锁定）：宿主/应用自身在会话中会**重新装载**当前文档（保存往返、外部改动、
 * 设置变更后的快照同步）。正常重装载走 `sync()` → `#installDocumentBoundary`；`reconcile()` 只用于
 * 同步出错后的恢复路径，并非本条的正常路径（code-reviewer 复审 LOW-3 更正了此前错误归因）。
 * 当重发的内容与编辑器当前内容
 * 存在**任何微小差异**（换行/尾空白归一即足够）时，渲染层会做一次**全量文档替换** ——
 * 而该路径**不保留滚动位置**，视口于是被弹回顶部。属主看到的「快速滚动到 3.1 一带 → 突然回顶部」
 * 与这一机制一致（纯滚轮本身已由 E31 证明不会跳）。
 */

const DEMO = readFileSync(
  fileURLToPath(new URL("./fixtures/demo-00-owner-repro.md", import.meta.url)),
  "utf-8",
);

async function scrollDown(page: Page, clicks: number): Promise<number> {
  const scroller = page.locator(".cm-scroller");
  await scroller.hover();
  for (let index = 0; index < clicks; index += 1) {
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(300);
  return page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
}

test.describe("S7 滚动位置保持（属主复现文档）", () => {
  test("E34/AC-S7：滚动后宿主重新装载同一文档（内容微小差异）不得把视口弹回顶部", async ({
    page,
  }) => {
    await openApp(page);
    await loadDoc(page, DEMO);

    const scrolled = await scrollDown(page, 8);
    expect(scrolled, "前置：滚轮确实把视口下移了").toBeGreaterThan(300);

    // 重新装载「同一文档」但内容存在微小差异 —— 等价于保存往返/外部改动后的快照重发。
    // 身份由宿主显式声明（architect 终审驱动项 ①）：渲染层不再从路径/内容前缀反推。
    await loadDoc(page, `${DEMO}\n`, "same");
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    expect(
      after,
      `重新装载后视口不得弹回顶部（滚动前 ${scrolled}，装载后 ${after}）`,
    ).toBeGreaterThan(scrolled * 0.5);
  });
});
