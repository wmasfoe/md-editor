import { test, type Page } from "@playwright/test";

/**
 * AC-9 计数器测量（A/B/C 三组的可判定证据来源）。
 *
 * - A：远离任一行内记录的纯文本处连续输入 100 个字符 ⇒ `visibleMarkBuildCount` 增量 0、
 *   `visibleMarkMapSkipCount` +100（G004 快速路径仍生效）。
 * - B：光标跨记录边界单步移动 ⇒ `visibleMarkBuildCount` +1~+2 / 次。
 * - C：开关 ON（等价改造前行为）下同一序列的计数，用于与改造前 commit 的基线对照。
 *
 * 结果以 `AC9_JSON <json>` 单行输出，便于脚本/人工留档。
 */
const DOC = ["Head", "", "xx **bold** yy", "", "far plain paragraph", ""].join("\n");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await page.locator(".cm-editor").waitFor();
}

async function diagnostics(page: Page) {
  return page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.getDiagnostics());
}

async function loadDocument(page: Page, markdown: string): Promise<void> {
  await page.evaluate((source) => {
    window.__CODEMIRROR_EDITOR_E2E__!.replaceDocument(source, "wysiwyg");
  }, markdown);
  await page.waitForFunction(
    (expected) =>
      window.__CODEMIRROR_EDITOR_E2E__!.getDiagnostics().renderer?.markdown === expected,
    markdown,
  );
}

async function setSelection(page: Page, from: number, to = from): Promise<void> {
  await page.evaluate(
    ([start, end]) => {
      window.__CODEMIRROR_EDITOR_E2E__!.setSelection(start, end);
    },
    [from, to],
  );
  await page.waitForFunction(
    (head) => window.__CODEMIRROR_EDITOR_E2E__!.getDiagnostics().renderer?.selectionHead === head,
    to,
  );
}

function counters(snapshot: Awaited<ReturnType<typeof diagnostics>>) {
  return {
    build: snapshot.renderer!.wysiwyg.visibleMarkBuildCount,
    mapSkip: snapshot.renderer!.wysiwyg.visibleMarkMapSkipCount,
  };
}

test("AC-9 A/B/C: 行内标记显隐的重建与快速路径计数", async ({ page }) => {
  await openHarness(page);
  await loadDocument(page, DOC);

  const boldFrom = DOC.indexOf("**bold**");
  const boldEnd = boldFrom + "**bold**".length;

  // ---- A：纯文本尾部连续输入 100 字符 ----
  const tail = (await diagnostics(page)).renderer!.markdown.length;
  await setSelection(page, tail, tail);
  const beforeA = counters(await diagnostics(page));
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.insertText("a");
  }
  const afterA = counters(await diagnostics(page));
  const groupA = {
    buildDelta: afterA.build - beforeA.build,
    mapSkipDelta: afterA.mapSkip - beforeA.mapSkip,
  };

  // ---- B：OFF 下光标跨记录边界单步移动 ----
  await loadDocument(page, DOC);
  await setSelection(page, boldFrom - 1);
  const stepsB: Array<{ buildDelta: number; mapSkipDelta: number }> = [];
  for (let step = 0; step < 2; step += 1) {
    const before = counters(await diagnostics(page));
    await page.keyboard.press("ArrowRight");
    const after = counters(await diagnostics(page));
    stepsB.push({
      buildDelta: after.build - before.build,
      mapSkipDelta: after.mapSkip - before.mapSkip,
    });
  }

  // ---- C：ON（等价改造前）下同一序列 ----
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__!.setInlineStyleMarkers(true));
  await loadDocument(page, DOC);
  await setSelection(page, boldFrom - 1);
  const stepsC: Array<{ buildDelta: number; mapSkipDelta: number }> = [];
  for (let step = 0; step < 2; step += 1) {
    const before = counters(await diagnostics(page));
    await page.keyboard.press("ArrowRight");
    const after = counters(await diagnostics(page));
    stepsC.push({
      buildDelta: after.build - before.build,
      mapSkipDelta: after.mapSkip - before.mapSkip,
    });
  }

  console.log(
    `AC9_JSON ${JSON.stringify({
      head: "889d30d",
      doc: DOC,
      boldRange: [boldFrom, boldEnd],
      groupA,
      groupB: stepsB,
      groupC: stepsC,
    })}`,
  );
});
