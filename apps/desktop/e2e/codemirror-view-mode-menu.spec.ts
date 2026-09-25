import { expect, test, type Page } from "@playwright/test";
import { openFullApp as openApp, runCommand } from "./editor-e2e-helpers";

/**
 * S1(b) / E35：**视图模式勾选态的镜像一致性**。
 *
 * 背景：原生 macOS 菜单的勾选态由 Rust 侧镜像渲染，浏览器内 E2E **无法断言原生菜单**。
 * 因此把「两条切换路径都会把真实开关态写进同一镜像」做成可自动化验证的 seam：
 * 宿主在请求写入时同时记录（`mode-menu-store`），E2E 通过桥面 `getModeMenuChecks()` 断言。
 * 原生菜单点击事件与命令面板走的是**同一段控制器代码**，故本用例覆盖两条路径的共同契约。
 */

async function readChecks(page: Page): Promise<{ focus: boolean; typewriter: boolean } | null> {
  return page.evaluate(() => window.__MD_EDITOR_E2E__?.getModeMenuChecks?.() ?? null);
}

test.describe("S1(b) 视图模式勾选态镜像", () => {
  test("E35/AC-S1-b：初始全关；面板开启后镜像随之变 true；两模式独立可叠加", async ({ page }) => {
    await openApp(page);
    expect(await readChecks(page), "初始应全关（与 renderer StateField 默认一致）").toEqual({
      focus: false,
      typewriter: false,
    });

    await runCommand(page, "Focus Mode");
    await expect
      .poll(() => readChecks(page), { timeout: 3000 })
      .toEqual({
        focus: true,
        typewriter: false,
      });

    await runCommand(page, "Typewriter Mode");
    await expect
      .poll(() => readChecks(page), { timeout: 3000 })
      .toEqual({ focus: true, typewriter: true });

    // 关闭专注不得影响打字机（视图轴可叠加、互不排斥）
    await runCommand(page, "Focus Mode");
    await expect
      .poll(() => readChecks(page), { timeout: 3000 })
      .toEqual({ focus: false, typewriter: true });

    // 与真实状态一致：专注已关 ⇒ **专注**的根标记必须消失（打字机不加根类，
    // 其可观察效果由 E15/E29 的居中用例覆盖）。镜像与实际状态由此互为佐证。
    await expect(page.locator(".cm-md-focus-mode"), "专注已关 ⇒ 专注根标记必须消失").toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__MD_EDITOR_E2E__?.getModeMenuChecks?.() ?? null))
      .toEqual({ focus: false, typewriter: true });
  });
});
