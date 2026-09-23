import { expect, test, type Page } from "@playwright/test";

/**
 * S2 / S3（编辑器交互 bug 批）—— Tab 决策正确性的 desktop E2E（真实 app 表面）。
 *
 * 根因（实测锁定，见提交说明）：
 *  - **#2**：仲裁 fallthrough 时把 Tab 交还浏览器 → 默认 Tab 导航把 DOM 焦点送进文档内的
 *    可聚焦元素（表格单元格 contenteditable 等）⇒ 视觉上“光标跳进表格”（属主复现）。
 *    修法：**修「文档内容不参与浏览器 Tab 链」这一不变量**（文档内控件 tabindex=-1）；
 *    CM6 腿 fallthrough 仍按既有尾契约**交还责任链**（不消费 Tab）。
 *    该不变量由 E32 结构护栏长期看守（枚举 `.cm-content` 内可 Tab 达元素）。
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

/** E32 夹具：表格 + 代码块 + 图片 —— 覆盖三类会渲染文档内控件/可焦点元素的 widget */
const TABBABLE_DOC = [
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
  "```js",
  "console.log(1);",
  "```",
  "",
  "![示例图](https://example.com/x.png)",
  "",
  "尾段。",
  "",
].join("\n");
const INSIDE_PARENS = 8;

/** 代码块夹具（S5）：光标置于正文行行首 */
const CODE_BLOCK = ["```js", "console.log(123)", "```", ""].join("\n");

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
    // 关键：真实用户随后会**点回正文**（焦点回到 .cm-content）。
    // 若焦点仍在单元格，Tab 走的是表格自己的「跳下一格」逻辑（那是正确行为，不是本 bug）。
    // 注意不能点 `.cm-content` 的几何中心 —— 本夹具表格占文档顶部，中心可能落在表格上。
    // 也不能用 hasText 匹配 `($a$)`：该行的数学原子 `$a$` 渲染后 textContent 不再是 `$a$`。
    // 文档以 `($a$)\n` 结尾，故最后一个 `.cm-line` 就是目标行。
    await page.locator(".cm-line").last().click();

    // 再把光标放回末行 `($a$)` 内
    const lineStart = OWNER_REPRO.lastIndexOf("($a$)");
    await setCaret(page, lineStart + 2);
    expect(await readCaret(page)).toBe(lineStart + 2);

    await page.keyboard.press("Tab");

    // ① 焦点不得进入表格单元格（S2 根因：单元格曾是唯一未设 tabindex 的文档内可聚焦元素）
    const focus = await focusInfo(page);
    expect(focus.inCellEditor, "Tab 后焦点不得落在表格单元格编辑器上").toBe(false);
    const onDocumentControl = await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest?.(".cm-content") && active.closest?.(".cm-md-"));
    });
    expect(onDocumentControl, "Tab 后焦点不得落在任何文档内 widget 控件上").toBe(false);

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

  test("E27/AC-S5：代码块内 Tab 后光标必须落在缩进之后（不得“长在光标左边”）", async ({ page }) => {
    await openApp(page);
    await setDoc(page, CODE_BLOCK, "wysiwyg");

    const bodyStart = CODE_BLOCK.indexOf("console.log");
    await setCaret(page, bodyStart);
    expect(await readCaret(page)).toBe(bodyStart);

    await page.keyboard.press("Tab");

    expect(await readDoc(page), "缩进应落在代码行行首").toBe(
      ["```js", "  console.log(123)", "```", ""].join("\n"),
    );
    expect(await readCaret(page), "光标必须随缩进右移（否则插入的空白会“长在光标左边”）").toBe(
      bodyStart + 2,
    );
  });

  test("E32/AC-S2c：文档内容（表格/代码块/图片控件）不得进入浏览器 Tab 链", async ({ page }) => {
    await openApp(page);
    await setDoc(page, TABBABLE_DOC, "wysiwyg");

    // 不变量：`.cm-content` 内的控件**不得**可 Tab 达（tabIndex >= 0）。
    // 否则 CM6 腿 fallthrough、Tab 交还浏览器时就会把焦点送进文档内控件 —— 正是属主 #2 的机制。
    // 新增 widget 若忘记 tabindex=-1，本护栏会红（把「逐个手工维护」升级为可失败的约束）。
    // 例外（**有意的可访问性 Tab 停点**，不得为修 #2 而删除）：
    //  - 文档内链接 `a[href]`
    //  - 代码块工具栏的**键盘可达操作**（`select` / 按钮）—— 由 M2 可访问性 spec
    //    `codemirror-m2-code-block-accessibility.spec.ts`（M2C-A01/A05「keyboard-reachable actions」）规格化要求
    //  - 图片 widget 的放大查看按钮与其源输入框（与代码块工具栏同类的可达操作）
    // 本护栏要拦的是**非有意**的可 Tab 控件：表格单元格编辑器 / 行列表格手柄 / 菜单项 等。
    const offenders = await page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      if (!content) {
        return ["<缺少 .cm-content>"];
      }
      const selector = 'button, select, input, textarea, [contenteditable="true"], [tabindex]';
      return Array.from(content.querySelectorAll<HTMLElement>(selector))
        .filter(
          (element) =>
            element.tabIndex >= 0 &&
            element.tagName !== "A" &&
            !element.closest(".cm-md-code-toolbar") &&
            !element.closest(".cm-md-image-widget"),
        )
        .map((element) => `${element.tagName}.${element.className}`.slice(0, 70));
    });
    expect(offenders, "文档内控件必须 tabindex=-1（新增 widget 请一并处理）").toEqual([]);
  });
});
