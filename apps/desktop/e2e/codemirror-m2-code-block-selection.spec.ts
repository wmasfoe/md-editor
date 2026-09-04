import { expect, test, type Page } from "@playwright/test";

const FIXTURE = [
  "前置段落内容",
  "",
  "```ts",
  "const alpha = 'hello';",
  "const beta = 123;",
  "const gamma = true;",
  "```",
  "",
  "后置段落内容",
].join("\n");

const SELECT_ALL_KEY = process.platform === "darwin" ? "Meta+a" : "Control+a";

async function openHarness(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor&mdx=1");
  await expect
    .poll(() => page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.isReady() ?? false))
    .toBe(true);
  await page.evaluate(() => window.__CODEMIRROR_EDITOR_E2E__?.mountEditor());
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const harness = window.__CODEMIRROR_EDITOR_E2E__;
    if (!harness) throw new Error("CodeMirror editor harness is unavailable.");
    return harness.getDiagnostics();
  });
}

test.describe("CodeMirror code-block selection visibility and boundary containment", () => {
  test("Mod-a in fenced code block selects only code body, shows selection at z-index 1, and leaves no stripe below", async ({
    page,
  }) => {
    await openHarness(page);
    await page.evaluate((source) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
    }, FIXTURE);

    const alphaStart = FIXTURE.indexOf("const alpha");
    const gammaEnd = FIXTURE.indexOf("true;") + "true;".length;

    // 光标定位在代码块第二行
    const betaPos = FIXTURE.indexOf("const beta");
    await page.evaluate((pos) => {
      window.__CODEMIRROR_EDITOR_E2E__?.setSelection(pos, pos);
    }, betaPos);

    // 第一次按 Mod-a：选中代码块内全部代码
    await page.keyboard.press(SELECT_ALL_KEY);

    const diag = await diagnostics(page);
    expect(diag.renderer).toMatchObject({
      selectionAnchor: alphaStart,
      selectionHead: gammaEnd,
      focused: true,
    });

    // 验证选区 DOM 图层层级、事件穿透属性以及多行垂直对齐
    const layerMetrics = await page.evaluate(() => {
      const selLayer =
        document.querySelector(".cm-md-selectionLayer") ??
        document.querySelector(".cm-selectionLayer");
      if (!selLayer) return null;
      const style = window.getComputedStyle(selLayer);
      const selBgs = Array.from(document.querySelectorAll(".cm-selectionBackground"))
        .filter((el) => window.getComputedStyle(el).display !== "none")
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
        });
      const firstCodeLine = document.querySelector(".cm-md-code-line--first");
      const firstLineRect = firstCodeLine ? firstCodeLine.getBoundingClientRect() : null;
      const lastCodeLine = document.querySelector(".cm-md-code-line--last");
      const lastLineRect = lastCodeLine ? lastCodeLine.getBoundingClientRect() : null;

      return {
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        selectionBackgroundCount: selBgs.length,
        selBgs,
        firstLineLeft: firstLineRect?.left ?? 0,
        maxSelectionBottom: Math.max(...selBgs.map((b) => b.bottom)),
        lastLineBottom: lastLineRect?.bottom ?? 0,
      };
    });

    expect(layerMetrics).not.toBeNull();
    expect(layerMetrics?.zIndex).toBe("1");
    expect(layerMetrics?.pointerEvents).toBe("none");
    expect(layerMetrics?.selectionBackgroundCount).toBeGreaterThan(0);

    // 核心断言 1：选区底边不得超过代码块最后一行的底边（允许 1.5px 亚像素渲染误差），绝不产生下方溢出横条
    expect(layerMetrics!.maxSelectionBottom).toBeLessThanOrEqual(
      layerMetrics!.lastLineBottom + 1.5,
    );

    // 核心断言 2：代码块全选时所有行的选区左边缘严格对齐（首行与后续行统一步调，标准差小于 1px）
    const leftCoords = layerMetrics!.selBgs.map((b) => b.left);
    const firstLeft = leftCoords[0];
    for (const left of leftCoords) {
      expect(Math.abs(left - firstLeft)).toBeLessThanOrEqual(1.0);
    }

    // 核心断言 3：选区左边缘不得贴在卡片最左侧边框上，必须与卡片左内边距（约 14px）保持留白，对齐代码字符
    expect(firstLeft).toBeGreaterThan(layerMetrics!.firstLineLeft + 8);

    // 第二次按 Mod-a：平滑委托给全文全选
    await page.keyboard.press(SELECT_ALL_KEY);
    const docDiag = await diagnostics(page);
    expect(docDiag.renderer).toMatchObject({
      selectionAnchor: 0,
      selectionHead: FIXTURE.length,
    });
  });

  test("mouse drag inside code block produces visible selection highlight", async ({ page }) => {
    await openHarness(page);
    await page.evaluate((source) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
    }, FIXTURE);

    const firstLine = page.locator(".cm-md-code-line").filter({ hasText: "const alpha" });
    const secondLine = page.locator(".cm-md-code-line").filter({ hasText: "const beta" });
    const firstBox = await firstLine.boundingBox();
    const secondBox = await secondLine.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    // 鼠标在代码块内部从第一行拖选至第二行末
    await page.mouse.move(firstBox!.x + 10, firstBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(secondBox!.x + 120, secondBox!.y + 10, { steps: 5 });
    await page.mouse.up();

    const dragDiag = await diagnostics(page);
    expect(dragDiag.renderer?.selectionRanges).toHaveLength(1);
    const range = dragDiag.renderer?.selectionRanges?.[0];
    expect(range?.anchor).toBeLessThan(range?.head ?? 0);

    // 验证有高亮矩形渲染
    const selCount = await page.locator(".cm-selectionBackground").count();
    expect(selCount).toBeGreaterThan(0);
  });

  test("typing backticks or brackets at empty cursor does not auto-close pairs", async ({
    page,
  }) => {
    await openHarness(page);
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("", "wysiwyg");
    });

    const content = page.locator(".cm-content");
    await content.click();

    // 敲击单个反引号 `
    await page.keyboard.press("Backquote");
    let docText = await page.evaluate(
      () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown,
    );
    expect(docText).toBe("`");

    // 连续再敲击两个反引号，构成 ```（绝不变成 ```` 四个）
    await page.keyboard.press("Backquote");
    await page.keyboard.press("Backquote");
    docText = await page.evaluate(
      () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown,
    );
    expect(docText).toBe("```");

    // 清空并测试左中括号 [
    await page.evaluate(() => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument("", "wysiwyg");
    });
    await content.click();
    await page.keyboard.press("BracketLeft");
    docText = await page.evaluate(
      () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown,
    );
    expect(docText).toBe("[");
  });

  test("cross-block selection involving code block atomically expands and allows deletion", async ({
    page,
  }) => {
    await openHarness(page);
    await page.evaluate((source) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
    }, FIXTURE);

    // 从前置段落划选进入代码块第一行
    const alphaPos = FIXTURE.indexOf("const alpha");
    await page.evaluate(
      ({ from, to }) => {
        window.__CODEMIRROR_EDITOR_E2E__?.setSelection(from, to);
      },
      { from: 0, to: alphaPos + 5 },
    );

    // 选区应原子扩展覆盖整个代码块
    const codeBlockEnd = FIXTURE.indexOf("```\n", FIXTURE.indexOf("```ts")) + 4;
    let diag = await diagnostics(page);
    expect(diag.renderer?.selectionAnchor).toBe(0);
    expect(diag.renderer?.selectionHead).toBe(codeBlockEnd);

    // 按 Backspace 删除整块选区
    await page.keyboard.press("Backspace");

    diag = await diagnostics(page);
    expect(diag.renderer?.markdown).toBe("\n后置段落内容");
  });

  test("mouse drag selection on line below code block selects target text accurately without coordinate offset", async ({
    page,
  }) => {
    await openHarness(page);
    const fixture = ["```ts", "123", "```", "123 **123**"].join("\n");
    await page.evaluate((source) => {
      window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(source, "wysiwyg");
    }, fixture);

    // 找到代码块下方的文本行
    const lineBelow = page.locator(".cm-line").filter({ hasText: "123" }).last();
    await expect(lineBelow).toBeVisible();

    const box = await lineBelow.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Target line bounding box is null");

    // 在目标文本正中拖拽鼠标选区
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    const diag = await diagnostics(page);
    // 选区应准确落在第二行文本范围内，而不是偏上落入代码块或者选不到
    const lineBelowStart = fixture.indexOf("123 **123**");
    const anchor = diag.renderer?.selectionAnchor ?? -1;
    const head = diag.renderer?.selectionHead ?? -1;
    expect(anchor).toBeGreaterThanOrEqual(lineBelowStart);
    expect(head).toBeGreaterThan(anchor);
  });
});
