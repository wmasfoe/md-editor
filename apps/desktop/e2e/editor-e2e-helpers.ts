import { expect, type Page } from "@playwright/test";
import type { DocumentReplaceIntent } from "@md-editor/editor-core";

/**
 * E2E 共享 helper（ai-slop-cleaner Pass 2 去重）：
 * 本批三个 spec（d1 / focus-typewriter / block-ops）原先各自复制了
 * openApp/loadDoc/readDoc/setCaret/runCommand —— 抽到此处一份。
 *
 * 两条桥（与「两桥接缝」记录一致）：
 *  - `app`     → `window.__MD_EDITOR_E2E__`（真实桌面 app，g007 同款 openFixture 挂载）
 *  - `harness` → `window.__CODEMIRROR_EDITOR_E2E__`（codemirror-editor harness 面）
 *
 * 既有 10+ 个旧 spec 仍用各自本地 helper（house 风格）——迁移到本模块属
 * 本批外的残余跟进项，见 ai-slop-cleaner-report。
 */

export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

export type E2eBridgeKind = "app" | "harness";

/** 打开真实 app 并挂载编辑器（g007 spec 同款路径） */
export async function openFullApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
  await page.evaluate(() => window.__MD_EDITOR_E2E__!.openFixture("/fixtures/s1-scroll.md"));
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

/** 用真实 app 桥替换文档内容，并轮询读回直至一致（自证挂载成功） */
/**
 * 装载文档（默认声明为「换文档」，即视口归零）。
 *
 * 传入 `replaceIntent: "same"` 表示这是**同一篇文档的重新装载**（保存往返/外部改动/快照重发），
 * 渲染层应保留阅读位置（S7 / architect 终审驱动项 ①：身份由宿主显式声明，渲染层不推断）。
 */
export async function loadDoc(
  page: Page,
  markdown: string,
  replaceIntent: DocumentReplaceIntent = "different",
): Promise<void> {
  await page.evaluate(
    ({ m, intent }) => window.__MD_EDITOR_E2E__!.replaceDocument(m, null, undefined, intent),
    { m: markdown, intent: replaceIntent },
  );
  await expect.poll(() => readDoc(page, "app")).toBe(markdown);
}

/** 读取当前文档 markdown（renderer probe，非 snapshot） */
export async function readDoc(page: Page, bridge: E2eBridgeKind = "app"): Promise<string> {
  return page.evaluate((kind) => {
    if (kind === "app") {
      return window.__MD_EDITOR_E2E__?.getDiagnostics().renderer?.markdown ?? "";
    }
    return window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown ?? "";
  }, bridge);
}

/** 程序化定位光标（renderer 标准端口，自带焦点，避免点击时序不稳） */
export async function setCaret(
  page: Page,
  pos: number,
  bridge: E2eBridgeKind = "app",
): Promise<void> {
  await page.evaluate(
    ({ at, kind }) => {
      if (kind === "app") {
        window.__MD_EDITOR_E2E__?.setSelection(at, at);
      } else {
        window.__CODEMIRROR_EDITOR_E2E__?.setSelection(at, at);
      }
    },
    { at: pos, kind: bridge },
  );
}

/** G007 命令面板执行（Mod/Ctrl+K → 搜索 → Enter → 关闭自证） */
export async function runCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press(`${MOD_KEY}+k`);
  const search = page.getByLabel(/命令搜索|Command search/);
  await expect(search).toBeVisible();
  await search.fill(query);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
}
