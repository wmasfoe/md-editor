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

  test("E40/AC-S7：属主原始路径（快速滚动 + 大纲跳 §3.1）不弹回顶部，且不触发文档替换", async ({
    page,
  }) => {
    // 属主原始描述是「**快速滚动**到 §3.1 一带 → 突然回顶部」。审计多次指出该**字面路径**
    // 此前只被「不声称已修」地记录，没有仪器化证据。本用例把它固化为可证伪的不变量：
    //   ① 快速滚轮本身不得弹回顶部（属主文档版，与 E31 的三态锁互补）；
    //   ② 用**大纲**跳 §3.1 后视口停在目标附近、光标落到该标题；
    //   ③ **跳转不得走「整篇文档替换」路径** —— 该路径正是 S7 的根因路径
    //      （若将来有人让大纲导航改走 replaceDocument，这里立即变红）。
    // 实测（2026-09-24 探针）：快速滚动后 scrollTop=3627；跳转后 2692（未回顶部）、
    // 光标 153→2010、替换计数 1→1（未新增）。
    const readState = async () =>
      page.evaluate(() => {
        const diagnostics = window.__MD_EDITOR_E2E__!.getDiagnostics();
        return {
          scrollTop: document.querySelector(".cm-scroller")!.scrollTop,
          replacements: diagnostics.renderer?.stateReplacementCount ?? -1,
          head: diagnostics.renderer?.selectionHead ?? -1,
        };
      });

    await openApp(page);
    await loadDoc(page, DEMO);

    const scrolled = await scrollDown(page, 12);
    const afterFastScroll = await readState();
    expect(scrolled, "① 快速滚动本身不得弹回顶部").toBeGreaterThan(300);
    expect(afterFastScroll.scrollTop).toBeGreaterThan(300);

    // ② 用标题栏的大纲浮层跳 §3.1
    const titleBar = page.locator(".group\\/titlebar-controls");
    await titleBar.hover();
    const outlineButton = page
      .getByRole("button", { name: "打开大纲浮层" })
      .or(page.locator("button[title='大纲']"))
      .or(page.locator("button[title='Outline']"));
    await expect(outlineButton).toBeVisible();
    await outlineButton.click();
    const nav = page.locator(
      "nav[aria-label='大纲目录'], nav[aria-label='Document outline'], nav[aria-label='文章大纲']",
    );
    await expect(nav).toBeVisible();
    const target = nav.getByRole("button", { name: /3\.1/ }).first();
    await expect(target).toBeVisible();
    await target.click();
    await page.waitForTimeout(700);

    const afterJump = await readState();
    expect(afterJump.scrollTop, "② 跳转后视口停在目标附近而非顶部").toBeGreaterThan(300);
    expect(afterJump.head, "② 光标应落到 §3.1 标题处（比滚动后更靠后）").toBeGreaterThan(
      afterFastScroll.head,
    );
    expect(
      afterJump.replacements - afterFastScroll.replacements,
      "③ 大纲跳转不得走整篇文档替换路径（S7 根因路径）",
    ).toBe(0);
  });
});
