import { expect, test, type Page } from "@playwright/test";
import { readDoc as readSharedDoc, setCaret as setSharedCaret } from "./editor-e2e-helpers";

/**
 * D-1 的 desktop Playwright E2E（S1b）。
 *
 * 覆盖集成层无法证明的**真实 app 保真度**部分：
 *  - E9 / T20    括号跳出全程零文本变更（undo 栈无新增、保存产物字节相同）
 *  - E10 / T20-cell 🔴 **PM-4 硬闸门**：单元格内跳出**先于 `flushCellCommit`**，
 *                   以**非规范 padded-row 夹具**（`|  a  | b |`）证明零文本变更
 *                   （padded 行会被 `buildCellReplacement` 整行规范化，正是最容易翻车处）
 *  - E19 / T17   IME 组合期放行原生（本批新增 harness `setCompositionActive` seam 驱动，含 D-1b 回归）
 *
 * 权威的三上下文复现闸门在集成层（`tab-arbitration-repro.test.ts`），
 * 本文件只做真实 app 保真度（PRD §10 N-2 的分工）。
 */

const PADDED_TABLE = ["|  a  | b |", "| - | - |", "|  c  | d |", ""].join("\n");
const PARAGRAPH = "前文\n\nfoo()\n\n后文\n";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await page.addStyleTag({
    content: ".cm-content { padding-left: 88px !important; }",
  });
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.isReady() ?? false))
    .toBe(true);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.mountEditor());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function replaceDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
  }, markdown);
}

/** 桥面别名：本 spec 走 harness（`__CODEMIRROR_EDITOR_E2E__`）；语义与共享 helper 单一 */
const readDoc = (page: Page): Promise<string> => readSharedDoc(page, "harness");

/** 程序化定位光标（共享 helper 的 harness 桥面别名） */
const setCaret = (page: Page, pos: number): Promise<void> => setSharedCaret(page, pos, "harness");

test.describe("D-1 Tab 跳出括号/link（真实 desktop app）", () => {
  test("E9/T20: foo(|) 按 Tab 跳出后文本逐字符不变（零文本变更）", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, PARAGRAPH);
    const before = await readDoc(page);

    // `前文\n\nfoo()\n\n后文\n` → `(` 在 5，`)` 在 6；光标落在二者之间 = 6
    await setCaret(page, 6);
    await page.keyboard.press("Tab");

    // T20 硬断言：文档字节完全不变（光标语义由集成层 T3–T9 覆盖）
    const after = await readDoc(page);
    expect(after, "括号跳出必须零文本变更").toBe(before);
  });

  test("E9b/T5: foo()| 不动点 —— 跳出层不吞掉 Tab（落到后续逻辑）", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, PARAGRAPH);
    const before = await readDoc(page);

    await setCaret(page, 7); // 已在 `)` 之后
    await page.keyboard.press("Tab");

    // 零文本变更；且光标不是被「跳出」推走（仍在原位或按后续逻辑移动）
    expect(await readDoc(page), "零文本变更").toBe(before);
  });

  // T17/E19（IME 组合期）：**已恢复为本文件的 E19**（终局评审 MEDIUM-2 更正）——
  // 本批为 harness 桥补上了 `setCompositionActive` seam（`codemirror-editor-harness.tsx`），
  // E19 用它真实驱动组合状态并断言 cell 光标原地（表格 DOM 腿三闸）。
  // 此前两版降级理由（「接口/实现漂移」→「两桥接缝缺口/不含该方法」）**均已作废**：
  // harness 现已持有该方法且 E19 正在调用它。D-1b 的权威行为断言仍为集成层
  // `tab-arbitration-repro.test.ts` 的 I2d（双闸门互补）。
});

test.describe("E10/T20-cell 🔴 PM-4 硬闸门：单元格内跳出先于 flushCellCommit", () => {
  test("padded-row 夹具：单元格内 f(|) 跳出后表格源码逐字符不变", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, PADDED_TABLE);
    const before = await readDoc(page);
    // 非规范夹具自检：确保真的是 padded 行（否则本用例失去意义）
    expect(before).toContain("|  a  | b |");

    // 在第一个 body 单元格里输入 `f()`，再用 ← 键把光标插到括号中间
    const cell = page.locator("table tbody td").first();
    await cell.click();
    await page.keyboard.type("f()");
    await page.keyboard.press("ArrowLeft");

    const beforeTab = await readDoc(page);
    await page.keyboard.press("Tab");
    const afterTab = await readDoc(page);

    // 🔴 PM-4 的核心断言：跳出**不得**触发 flushCellCommit 的整行重序列化。
    // padded 行（`|  c  | d |`）若被规范化成 `| c | d |`，即证明顺序契约被破坏。
    expect(afterTab, "T20-cell：跳出必须零文本变更（不得 commit 单元格）").toBe(beforeTab);
    expect(afterTab, "padded 行不得被静默规范化").toContain("|  c  | d |");
  });

  test("E18/T2 表格腿：建议激活时 Tab 先走 AI 接受（接受先于 cell commit）", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, PADDED_TABLE);
    expect(await readDoc(page), "非规范夹具自检").toContain("|  a  | b |");

    // E10 同款交互：点进第一个 body 单元格（cell-caret 同步 CM 选区）
    const cell = page.locator("table tbody td").first();
    await cell.click();

    // M9 seam：取光标坐标 → 在其上注入建议（单元格文本 ` c ` 无括号）
    const snap = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__!.getSelectionSnapshot(),
    );
    await page.evaluate(
      ({ from, to }) =>
        window.__CODEMIRROR_EDITOR_E2E__!.showSuggestion({ from, to, text: "AI 续写。" }),
      snap,
    );
    expect(
      await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getSuggestion()),
      "建议注入应可见（否则本用例失去意义）",
    ).not.toBeNull();

    const beforeTab = await readDoc(page);
    await page.keyboard.press("Tab");
    const afterTab = await readDoc(page);

    // 判定链（🔸 演绎）：cell 无括号 → escape 必为 false；建议在场 → 统一 arbiter 必先调
    // accept：
    //  - accept **合法插入**建议文本（故 doc 会变，不能断言整体相等）；
    //  - 若顺序错误（commit 先跑），`buildCellReplacement` 会把 padded 行整行规范化。
    // 两联立：**建议文本已插入** ∧ **padded 行仍在** ⟺ 接受先于 cell commit。
    expect(afterTab, "padded 行仍在（flushCellCommit 未跑，否则整行规范化）").toContain(
      "|  c  | d |",
    );
    expect(afterTab, "建议文本已插入（accept 腿已执行）").toContain("AI 续写。");
    expect(beforeTab, "前置：注入后、Tab 前 padded 行仍在").toContain("|  c  | d |");
  });

  test("E19/M6 🔴：IME 组合期单元格 Tab 不跳出（表格 DOM 腿 composition 门控）", async ({
    page,
  }) => {
    await openHarness(page);
    await replaceDocument(page, PADDED_TABLE);

    // E10 同款：点进 body 单元格，输入 f() 并把光标插到括号中间
    const cell = page.locator("table tbody td").first();
    await cell.click();
    await page.keyboard.type("f()");
    await page.keyboard.press("ArrowLeft");

    const caretState = () =>
      page.evaluate(() => {
        const sel = document.getSelection();
        return sel
          ? `${sel.anchorOffset}:${sel.focusOffset}:${sel.anchorNode?.textContent ?? ""}`
          : "";
      });
    const beforeCaret = await caretState();
    const beforeDoc = await readDoc(page);

    // 轮1 architect concern-6（dispatch 级钉子）：表格 DOM 腿必须阻断 Tab 冒泡到 CM6
    // —— `tab-arbiter-command` 的 `inTableCell:false` 契约依赖这条 stopPropagation。
    await page.evaluate(() => {
      const sink = { count: 0 };
      (window as unknown as { __tabBubbles?: { count: number } }).__tabBubbles = sink;
      document.querySelector(".cm-content")?.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Tab") {
          sink.count += 1;
        }
      });
    });

    // 驱动组合期（harness 桥新增 setCompositionActive seam，与 e2e-bridge 同款）→ Tab
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setCompositionActive(true));
    await page.keyboard.press("Tab");
    await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setCompositionActive(false));

    expect(
      await page.evaluate(
        () => (window as unknown as { __tabBubbles?: { count: number } }).__tabBubbles?.count ?? -1,
      ),
      "🔴 stopPropagation 契约（inTableCell:false 依赖）：Tab 不得冒泡到 CM6 contentDOM",
    ).toBe(0);

    const afterCaret = await caretState();
    expect(afterCaret, "🔴 组合期 Tab 不得跳出括号（cell 光标必须原地）").toBe(beforeCaret);
    expect(await readDoc(page), "组合期零文本变更").toBe(beforeDoc);
  });

  test("MEDIUM-4：cell 有未提交输入时，Tab 不走接受腿（输入必须落盘不丢）", async ({ page }) => {
    await openHarness(page);
    await replaceDocument(page, PADDED_TABLE);

    const cell = page.locator("table tbody td").first();
    await cell.click();

    // 注入建议（其内部 view.focus() 会抢焦 → cell 编辑会话中断；故注入后**重进 cell**再制造输入）
    const snap = await page.evaluate(() =>
      window.__CODEMIRROR_EDITOR_E2E__!.getSelectionSnapshot(),
    );
    await page.evaluate(
      ({ from, to }) =>
        window.__CODEMIRROR_EDITOR_E2E__!.showSuggestion({ from, to, text: "AI 续写。" }),
      snap,
    );
    expect(
      await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getSuggestion()),
      "建议在场（否则本用例测不到接受腿）",
    ).not.toBeNull();

    // 重进 cell 并制造**未提交输入**（与时序无关地构造 MEDIUM-4 前提）
    await cell.click();
    await page.keyboard.type("x");
    expect(await readDoc(page), "前置：输入仅在 cell DOM、未进文档").not.toContain("x");
    expect(
      await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getSuggestion()),
      "重进 cell/输入不得清掉建议（选区仍在建议区间内）",
    ).not.toBeNull();

    await page.keyboard.press("Tab");
    const afterTab = await readDoc(page);
    expect(afterTab, "🔴 未提交输入必须落盘（不得被接受腿的重渲染静默吞掉）").toContain("x");
    expect(afterTab, "联合断言：接受腿被护栏正确跳过（AI 文本不得插入）").not.toContain(
      "AI 续写。",
    );
  });
});
