import { expect, test, type Page } from "@playwright/test";

/**
 * S2 / S3（编辑器交互 bug 批）—— Tab 决策正确性的 desktop E2E（真实 app 表面）。
 *
 * 根因（实测锁定，见提交说明）：
 *  - **#2**：仲裁 fallthrough 时把 Tab 交还浏览器 → 默认 Tab 导航把 DOM 焦点送进文档内的
 *    可聚焦元素（表格单元格 contenteditable 等）⇒ 视觉上“光标跳进表格”（属主复现）。
 *    修法：CM6 腿 fallthrough **消费** Tab（编辑器内 Tab 永不逃逸焦点）。
 *  - **#1**：源码模式无门控 ⇒ 括号/链接跳出照常发生。修法：编辑轴事实入纯决策函数。
 *
 * 用例设计要点：**必须有对照组**（E24）—— 否则“什么都不做”也能让“文本不变”类断言通过
 * （这正是旧 E9 用例失效的原因：它只断言文本不变，而当时 Tab 根本没被处理）。
 */

/** 属主给的原始复现文档（表格首格 `$b$` + `---` + 末行 `($a$)`） */
const OWNER_REPRO = [
  "| $b$ `renderPolicy` | 适用场景 | 交互表现 |",
  "| :--- | :--- | :--- |",
  '| `"directive-panel"` | 块级卡片、提示面板（如 `:::info`、Alerts） | 首行替换为精美标签栏卡片头，正文可编辑，光标离开自动收起标记 |',
  "",
  "---",
  "($a$)",
  "",
].join("\n");

/** `前文\n\nfoo()\n\n后文\n`：`(` = 7、`)` = 8；括号“内”= 8 */
const PARAGRAPH = "前文\n\nfoo()\n\n后文\n";
const INSIDE_PARENS = 8;

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#welcome-title")).toBeVisible();
  await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function setDoc(page: Page, markdown: string, mode: "wysiwyg" | "source"): Promise<void> {
  await page.evaluate(
    ({ source, targetMode }) => {
      window.__MD_EDITOR_E2E__?.replaceDocument(source, "/fixtures/test.md", targetMode);
    },
    { source: markdown, targetMode: mode },
  );
  await expect
    .poll(async () =>
      page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics()?.renderer?.markdown ?? ""),
    )
    .toBe(markdown);
}

async function setCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((at) => window.__MD_EDITOR_E2E__?.setSelection(at, at), pos);
}

async function readCaret(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__MD_EDITOR_E2E__?.getDiagnostics()?.renderer?.selectionHead ?? -1,
  );
}

async function readDoc(page: Page): Promise<string> {
  return page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics()?.renderer?.markdown ?? "");
}

/** 焦点落点观测：是否仍在编辑器内、是否落在表格单元格编辑器上 */
async function focusInfo(page: Page): Promise<{ inEditor: boolean; inCellEditor: boolean }> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const className = (active?.className ?? "").toString();
    return {
      inEditor: Boolean(active?.closest?.(".cm-editor")),
      inCellEditor: className.includes("cell-editor"),
    };
  });
}

test.describe("S2/S3 Tab 决策正确性（真实 desktop app）", () => {
  test("E22/AC-S2：末行括号内按 Tab 不得把焦点/光标送进上方表格", async ({ page }) => {
    await openApp(page);
    await setDoc(page, OWNER_REPRO, "wysiwyg");

    // 属主复现的前置：先与表格交互（单元格编辑器获得焦点）
    const cell = page.locator(".cm-md-table-widget td, .cm-md-table-widget th").first();
    await expect(cell).toHaveCount(1);
    await cell.click();

    // 再把光标放回末行 `($a$)` 内
    const lineStart = OWNER_REPRO.lastIndexOf("($a$)");
    await setCaret(page, lineStart + 2);
    expect(await readCaret(page)).toBe(lineStart + 2);

    await page.keyboard.press("Tab");

    // ① 焦点不得进入表格单元格（S2 根因：单元格曾是唯一未设 tabindex 的文档内可聚焦元素）
    const focus = await focusInfo(page);
    expect(focus.inCellEditor, "Tab 后焦点不得落在表格单元格编辑器上").toBe(false);

    // ② CM 光标必须仍在末行（不得被送进表格）
    const head = await readCaret(page);
    expect(head, `Tab 后光标必须仍在末行（实际 ${head}）`).toBeGreaterThanOrEqual(lineStart);
    expect(head, `Tab 后光标不得越过本行末尾（实际 ${head}）`).toBeLessThanOrEqual(
      lineStart + "($a$)".length,
    );

    // ③ 零文本变更
    expect(await readDoc(page), "Tab 不得改动文本").toBe(OWNER_REPRO);
  });

  test("E23/AC-S3：源码模式下 Tab 不得触发括号跳出，而是行级普通缩进", async ({ page }) => {
    await openApp(page);
    await setDoc(page, PARAGRAPH, "source");

    await setCaret(page, INSIDE_PARENS);
    expect(await readCaret(page)).toBe(INSIDE_PARENS);

    await page.keyboard.press("Tab");

    // 属主口径「仅普通缩进」：行首插 2 空格（不是 4 —— 4 会把段落变成缩进代码块），光标随插入量右移
    expect(await readDoc(page), "源码模式下 Tab 应做行级缩进").toBe("前文\n\n  foo()\n\n后文\n");
    expect(await readCaret(page), "光标应随缩进右移 2").toBe(INSIDE_PARENS + 2);
  });

  test("E24/AC-S2b：所见即所得下同一位置 Tab 必须跳出（对照组，防「什么都不做也算通过」）", async ({
    page,
  }) => {
    await openApp(page);
    await setDoc(page, PARAGRAPH, "wysiwyg");

    await setCaret(page, INSIDE_PARENS);
    await page.keyboard.press("Tab");

    expect(await readCaret(page), "所见即所得下必须跳出到 `)` 之后（否则说明 Tab 未被仲裁）").toBe(
      INSIDE_PARENS + 1,
    );
    expect(await readDoc(page), "跳出必须零文本变更").toBe(PARAGRAPH);
  });
});
