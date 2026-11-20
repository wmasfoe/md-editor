import { expect, test } from "@playwright/test";

function percentile(values: number[], p: number): number {
  return values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? 0;
}

const makeFixture = (): string => {
  const blocks = Array.from({ length: 500 }, (_, index) => {
    const id = String(index).padStart(4, "0");
    const code = index === 0 ? "\n```text\nvisible code widget\n```\n" : "";
    return `## Section ${id}\n\nEnglish paragraph ${id} with 中文内容 and 日本語。\n${code}\n- item ${id}\n`;
  });
  return blocks.join("\n");
};

test("S6 measures a mounted EditorView on a stable large mixed-language fixture", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = makeFixture();
  const mountStart = performance.now();
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  const mountMs = performance.now() - mountStart;

  const replaceMs = await page.evaluate((markdown) => {
    const start = performance.now();
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, null, "wysiwyg");
    return performance.now() - start;
  }, fixture);
  await expect(page.locator(".cm-editor .cm-line").first()).toBeVisible();

  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.setSelection(10, 10));
  // Let first layout/parse work settle so input samples measure editing, not initial hydration.
  await page.waitForTimeout(500);
  await page.keyboard.insertText("warmup");
  const inputMs: number[] = [];
  for (const character of ["x", "中", "文", "🙂", ..."benchmark".repeat(3)]) {
    const start = performance.now();
    await page.keyboard.insertText(character);
    inputMs.push(performance.now() - start);
  }

  const scroll = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) throw new Error("EditorView scroller is missing");
    const frames: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < 30; index += 1) {
      scroller.scrollTop =
        (index * 997) % Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
    }
    const memory = performance as Performance & { memory?: { usedJSHeapSize: number } };
    return {
      frameP95Ms: frames.toSorted((a, b) => a - b)[Math.floor(frames.length * 0.95)],
      heapUsedBytes: memory.memory?.usedJSHeapSize ?? null,
      scrollHeight: scroller.scrollHeight,
      lineCount: document.querySelectorAll(".cm-content .cm-line").length,
    };
  });
  const diagnostics = await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics());
  const result = {
    fixtureChars: fixture.length,
    fixtureLines: fixture.split("\n").length,
    mountToEditorMs: Number(mountMs.toFixed(1)),
    replaceDocumentMs: Number(replaceMs.toFixed(1)),
    keyboardInputP50Ms: Number(percentile(inputMs, 0.5).toFixed(1)),
    keyboardInputP95Ms: Number(percentile(inputMs, 0.95).toFixed(1)),
    keyboardInputSamplesMs: inputMs.map((value) => Number(value.toFixed(1))),
    ...scroll,
    editorCount: diagnostics?.cmEditorCount,
    widgetLifecycle: diagnostics?.renderer?.wysiwyg,
  };
  console.log(`S6_BENCHMARK ${JSON.stringify(result)}`);
  expect(result.editorCount).toBe(1);
  expect(result.scrollHeight).toBeGreaterThan(5_000);
  expect(result.fixtureLines).toBeGreaterThan(2_500);
});
