import { expect, test, type Page } from "@playwright/test";
import { openFullApp as openApp } from "./editor-e2e-helpers";

/**
 * 属主手测缺陷（裸 URL 不可编辑/不可删除）—— E42。
 *
 * 现象（属主）：直接打字输入 `https://example.com/some/path` 这种裸链接后，
 * 光标一旦离开该处再回来就**改不了**，而且**删不掉**；光标进/点击时会出**黑色描边**。
 *
 * 根因（源码 + 探针双确认）：`packages/renderer-codemirror/src/markdown/node-policy.ts`
 * 的 `BARE_AUTOLINK_POLICY` 给裸 URL 赋了 `renderPolicy: "source-only-atom"` +
 * `editPolicy: "source-mode-only"` + `interactionPolicy: "source-mode-required"` ⇒
 * ① 不渲染（普通黑字）② 作为**原子**（描边、光标进不去内部）③ 所见即得模式下**受保护**（改不了）
 * ④ 不在 `atom-selection.ts` 的 `DeletableAtom` 白名单（image/thematic-break/table/html）⇒ 删不掉。
 *
 * 本用例锁**行为契约**（不锁实现）：裸 URL 就是普通文本 —— 能落光标进内部就地编辑、能删除。
 * `<https://…>` 形态（尖括号 autolink）**不在本用例范围**：它渲染为链接、点击即可编辑，语义不同。
 */
const URL = "https://example.com/some/path";
const DOC = `看 ${URL} 结束`;

async function readSelection(page: Page): Promise<{ anchor: number; head: number }> {
  return page.evaluate(() => {
    const renderer = window.__MD_EDITOR_E2E__!.getDiagnostics().renderer;
    return { anchor: renderer?.selectionAnchor ?? -1, head: renderer?.selectionHead ?? -1 };
  });
}

async function readHead(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__MD_EDITOR_E2E__!.getDiagnostics().renderer?.selectionHead ?? -1,
  );
}

async function readDoc(page: Page): Promise<string> {
  return page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics().renderer?.markdown ?? "");
}

test.describe("裸 URL 的编辑语义（属主手测）", () => {
  test("E42：打字输入的裸 URL 必须能落光标进内部编辑，且能删除", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.replaceDocument("", null, "wysiwyg"));
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await page.locator(".cm-content").click();

    // 用**真实打字**产生该记录（探针已确认：打字路径同样产出该原子记录）
    await page.keyboard.type(DOC);
    await expect.poll(() => readDoc(page), { message: "前置：文本已输入" }).toBe(DOC);

    const urlStart = DOC.indexOf(URL);
    const urlEnd = urlStart + URL.length;

    // ① 方向键从右侧进入必须能落进 URL **内部**（今天：整段原子跳过 ⇒ 红）
    await page.keyboard.press("End");
    const presses = DOC.length - (urlEnd - 1); // 走到 URL 倒数第一个字符所需次数
    for (let index = 0; index < presses; index += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    const head = await readHead(page);
    expect(
      head,
      `方向键必须能进入裸 URL 内部（实际 head=${head}，URL 区间=${urlStart}..${urlEnd}）`,
    ).toBeGreaterThanOrEqual(urlStart);
    expect(head, `方向键进入后光标应落在 URL 内部（实际 head=${head}）`).toBeLessThan(urlEnd);

    // ①b URL 内部输入必须**就地生效**（今天：保护层静默拒绝 ⇒ 文本不变 ⇒ 红）
    await page.keyboard.type("Z");
    await expect
      .poll(() => readDoc(page), { message: "裸 URL 内部必须可以输入（不得被保护层静默拒绝）" })
      .toBe(DOC.slice(0, head) + "Z" + DOC.slice(head));
    await page.keyboard.press("Meta+z"); // 还原，供 ② 从同一基线开始
    await expect.poll(() => readDoc(page)).toBe(DOC);

    // ② 在 URL 右缘处按 Backspace 必须真的删掉一个字符（今天：受保护被拦 ⇒ 文本不变 ⇒ 红）
    await page.evaluate((at) => window.__MD_EDITOR_E2E__!.setSelection(at, at), urlEnd);
    await page.keyboard.press("Backspace");
    await expect
      .poll(() => readDoc(page), { message: "裸 URL 必须可删除（受保护原子会静默拒绝）" })
      .toBe(DOC.slice(0, urlEnd - 1) + DOC.slice(urlEnd));
  });

  /**
   * 同类缺陷（属主手测："a 和 b 都会遇到"）：**尖括号 autolink** 与**引用式链接**在 WYSIWYG 下
   * 同样是「黑字 + 原子描边 + 改不了 + 删不掉」——它们与裸 URL 一样被赋了
   * `source-only-atom` / `source-mode-only` / `source-mode-required`。
   *
   * 对照事实（探针实测）：行内链接 `[点我](…)` 走的是 `link-segmented` 策略 ⇒ 逐步可进入、
   * 双击可就地改、整串选中可删除 ✅ —— 本用例锁的是另两种形态应达到**同等**的可编辑/可删除语义。
   */
  const AUTO = "<https://example.com/a(b)>";
  const REF_LINK = "[点我][ref]";

  test("E43：尖括号 autolink 与引用式链接必须能落光标进内部、且能整串删除", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(".cm-editor")).toHaveCount(1);

    for (const [name, snippet] of [
      ["尖括号 autolink", AUTO],
      ["引用式链接", REF_LINK],
    ] as const) {
      const caseDoc = `前 ${snippet} 后\n`;
      await page.evaluate((m) => window.__MD_EDITOR_E2E__!.replaceDocument(m), caseDoc);
      await expect.poll(() => readDoc(page), { message: `${name}：前置文本` }).toBe(caseDoc);

      const from = caseDoc.indexOf(snippet);
      const to = from + snippet.length;

      // ① 方向键从左侧进入：必须**落进内部**（今天：整段原子选中 ⇒ 红）
      await page.evaluate((at) => window.__MD_EDITOR_E2E__!.setSelection(at, at), from - 1);
      // 按**两次**：旧行为下第一次到原子左缘（折叠）、第二次会整段选中 ⇒ 只有两次都折叠才算真的
      // "能走进去"（按一次在两种行为下都折叠，无法判别 —— 该断言曾被这样写空转过）。
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
      const selection = await readSelection(page);
      // 原子选中的特征是 **anchor ≠ head 且覆盖整段**；正常进入必须是折叠选区且落在区间内。
      expect(
        selection.anchor,
        `${name}：方向键进入后不得整段原子选中（实际 anchor=${selection.anchor} head=${selection.head}）`,
      ).toBe(selection.head);
      expect(
        selection.head,
        `${name}：方向键进入后光标必须落在该文本区间内（实际 head=${selection.head}，区间=${from}..${to}）`,
      ).toBeGreaterThanOrEqual(from);
      expect(selection.head, `${name}：不得越过该文本右界`).toBeLessThanOrEqual(to);

      // ② 整串选中后 Backspace 必须真的删除（今天：受保护 ⇒ 文本不变 ⇒ 红）
      await page.evaluate((range) => window.__MD_EDITOR_E2E__!.setSelection(range.from, range.to), {
        from,
        to,
      });
      await page.keyboard.press("Backspace");
      await expect
        .poll(() => readDoc(page), { message: `${name}：整串选中后必须可删除` })
        .toBe(`前  后\n`);
    }
  });
});
