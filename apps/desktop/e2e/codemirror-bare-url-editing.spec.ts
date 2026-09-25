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
});
