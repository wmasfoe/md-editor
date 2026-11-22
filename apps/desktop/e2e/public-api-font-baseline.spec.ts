/**
 * @file public-api-font-baseline.spec.ts
 * @description P0 字号基线（e2e 层）。这是"桌面端字号不许静默变化"的唯一机器守卫。
 *
 * 为什么必须在 e2e：`packages/editor` 单测跑在 node 环境，jsdom 对
 * `font-size: var(--x, inherit)` 会返回**字面字符串**而不是解析后的像素值，
 * 继承链也拿不到。计算样式只能由真实浏览器证明。
 *
 * 锁定的三件事：
 *  1. 真实 app 表面：默认设置为 17px（`apps/desktop/src/app/settings/editor/defaults.ts`）。
 *     P2 把 `fontSize` prop 迁到 `theme.typography.fontSize` 后，这一条必须仍然绿。
 *  2. 不传排版 props 时的继承基线：外层容器 21px → `.cm-scroller` 21px。
 *     这是 P2 之后 `var(--theme-editor-font-size, inherit)` 的 fallback 行为基线。
 *  3. 显式 19px：`.cm-scroller` 真的解析到 19px（证明变量链路生效，而不只是写在 host 上）。
 */
import { expect, test, type Page } from "@playwright/test";

const SCROLLER = ".cm-md-editor .cm-scroller";

async function openFullApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
  await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&standalone=1");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics()))
    .toMatchObject({ rendererAccess: "available", cmEditorCount: 1 });
}

async function scrollerFontSize(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const scroller = document.querySelector(selector);
    if (!scroller) throw new Error(`missing ${selector}`);
    return getComputedStyle(scroller).fontSize;
  }, SCROLLER);
}

test("真实 app 表面：默认字号 17px（P2 迁移后必须不变）", async ({ page }) => {
  await openFullApp(page);
  await expect.poll(() => scrollerFontSize(page)).toBe("17px");
});

test("不传排版 props：.cm-scroller 继承外层容器字号（21px 基线）", async ({ page }) => {
  await openHarness(page);
  // 显式“不传 fontSize prop”，并把外层容器设为非默认字号，让继承可判别。
  await page.evaluate(() => {
    window.__CODEMIRROR_EDITOR_E2E__?.setFontSize(null);
    const host = document.querySelector<HTMLElement>(".code-mirror-editor-host");
    const parent = host?.parentElement;
    if (!parent) throw new Error("editor host has no parent");
    parent.style.fontSize = "21px";
  });
  await expect.poll(() => scrollerFontSize(page)).toBe("21px");
});

test("显式 19px：.cm-scroller 解析到 19px（变量链路生效）", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setFontSize(19));
  await expect.poll(() => scrollerFontSize(page)).toBe("19px");
});
