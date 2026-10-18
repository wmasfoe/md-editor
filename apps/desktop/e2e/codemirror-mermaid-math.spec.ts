import { expect, test } from "@playwright/test";
import { loadDoc, openFullApp } from "./editor-e2e-helpers";

/**
 * Mermaid 标签内数学公式回归 —— KaTeX 版本收敛（O1-P1）的前置验证。
 *
 * mermaid 11.x 内部对 KaTeX 的调用形状是：
 *   katex.renderToString(c, { throwOnError: true, displayMode: true, output })
 * 见 `node_modules/.pnpm` 下 mermaid 包内 `dist/chunks/mermaid.core/chunk-<hash>.mjs`
 * 的 `renderKatexUnsanitized`。仓库把 mermaid 的 `katex` 依赖 override 到与其余包一致的版本后，
 * 必须有一条真实浏览器证据：标签里的 `$$…$$` 仍被渲染为 katex 标记，且没有降级文案。
 *
 * 为什么必须是浏览器：`mermaid.render` 需要真实 DOM，node 环境下直接 `document is not defined`。
 */

const MERMAID_MATH_DOC = [
  "# Mermaid 数学",
  "",
  "```mermaid",
  "graph TD",
  '  A["$$x^2 + y^2 = z^2$$"] --> B["普通标签"]',
  "```",
  "",
].join("\n");

test.describe("Mermaid 标签内 KaTeX 数学（版本收敛回归）", () => {
  test("M-MATH1: 标签中的 $$...$$ 渲染为 katex 标记且无降级文案", async ({ page }) => {
    test.setTimeout(60_000);
    await openFullApp(page);
    await loadDoc(page, MERMAID_MATH_DOC);

    const container = page.locator(".cm-md-mermaid-container").first();
    await expect(container).toBeVisible({ timeout: 30_000 });

    // mermaid 内部 KaTeX 成功参与渲染（失败时会留下 error 卡片或降级文案）
    await expect(container.locator(".katex").first()).toBeVisible({ timeout: 30_000 });
    await expect(container).not.toContainText("MathML is unsupported");
    await expect(container).not.toContainText("Katex is not supported");
    await expect(container.locator(".cm-md-mermaid-error")).toHaveCount(0);
  });
});
