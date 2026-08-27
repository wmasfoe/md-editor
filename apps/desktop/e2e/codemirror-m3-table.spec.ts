import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const TABLE_MARKDOWN = [
  "Before table.",
  "",
  "| Header A | Header B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "",
  "After table.",
  "",
].join("\n");

const TABLE_BLOCK = ["| Header A | Header B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join(
  "\n",
);

const BOUNDARY_MARKDOWN = [
  "| [^inner] | note |",
  "| --- | --- |",
  "| cell | body |",
  "",
  "[^outside]",
  "",
  "[^outside]: Footnote body",
  "",
].join("\n");

const PASTE_KEY = process.platform === "darwin" ? "Meta+v" : "Control+v";
const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";

const widget = (page: Page) => page.locator(".cm-md-table-widget");
const grid = (page: Page) => page.locator("table.cm-md-table-widget__grid");
const bodyCell = (page: Page, rowIndex: number, colIndex: number) =>
  page.locator(
    `.cm-md-table-widget__cell[data-row-kind="body"][data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`,
  );

test.describe("CodeMirror M3 table interaction surface", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantClipboard(context);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
  });

  async function loadTable(page: Page, markdown: string): Promise<void> {
    await page.evaluate(
      (source) => window.__MD_EDITOR_E2E__!.replaceDocument(source, "/fixtures/m3-table.md"),
      markdown,
    );
    await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
    await expect(page.locator(".cm-editor")).toHaveCount(1);
  }

  test("B2: tables always render as an editable grid without source echo", async ({ page }) => {
    await loadTable(page, TABLE_MARKDOWN);

    // 恒网格：role=grid + 可编辑单元格，原文（GFM 表格源码）不回显。
    await expect(grid(page)).toHaveCount(1);
    await expect(widget(page)).toHaveAttribute("role", "group");
    await expect(widget(page)).toHaveAttribute("aria-label", "Markdown table");
    await expect(grid(page)).toHaveAttribute("role", "grid");
    await expect(page.locator(".cm-content")).not.toContainText(TABLE_BLOCK);
    await expect(page.locator(".cm-content")).not.toContainText("| Header A |");

    const headerCells = page.locator("thead .cm-md-table-widget__cell");
    await expect(headerCells).toHaveCount(2);
    await expect(page.locator("thead th[scope='col']")).toHaveCount(2);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(bodyCell(page, 0, 0)).toContainText("1");
    await expect(bodyCell(page, 0, 1)).toHaveText("2");
    await expect(bodyCell(page, 1, 0)).toContainText("3");
    await expect(bodyCell(page, 1, 1)).toHaveText("4");
  });

  test("B3: cells edit in place with Enter/Tab/Shift+Tab commit and Escape cancel", async ({
    page,
  }) => {
    await loadTable(page, TABLE_MARKDOWN);

    // 左键单击进入就地编辑；End 到行尾后键入追加。
    const first = bodyCell(page, 0, 0);
    await first.click();
    await expect(first).toHaveClass(/cm-md-table-widget__cell--editing/u);
    await page.keyboard.press("End");
    await page.keyboard.type("alpha");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN.replace("| 1 | 2 |", "| 1alpha | 2 |"));
    // Enter 提交后焦点下移一行（同列）。
    await expect(bodyCell(page, 1, 0)).toHaveClass(/cm-md-table-widget__cell--editing/u);

    // Tab 提交当前单元格并右移。
    await page.keyboard.press("End");
    await page.keyboard.type("beta");
    await page.keyboard.press("Tab");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace("| 1 | 2 |", "| 1alpha | 2 |").replace("| 3 | 4 |", "| 3beta | 4 |"),
      );
    await expect(bodyCell(page, 1, 1)).toHaveClass(/cm-md-table-widget__cell--editing/u);

    // Shift+Tab 左移回上一格。
    await page.keyboard.press("Shift+Tab");
    await expect(bodyCell(page, 1, 0)).toHaveClass(/cm-md-table-widget__cell--editing/u);

    // Escape 取消：源码文本恢复、不产生事务。
    await page.keyboard.press("End");
    await page.keyboard.type("discarded");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace("| 1 | 2 |", "| 1alpha | 2 |").replace("| 3 | 4 |", "| 3beta | 4 |"),
      );
    await expect(bodyCell(page, 1, 0)).toContainText("3beta");
    await expect(bodyCell(page, 1, 0)).not.toHaveClass(/cm-md-table-widget__cell--editing/u);
  });

  test("B4: row/col block handles and action menus mutate the table without breaking source", async ({
    page,
  }) => {
    await loadTable(page, TABLE_MARKDOWN);

    // 悬停表格显示手柄（默认透明）。
    await widget(page).hover();
    await expect(page.locator("[data-table-toggle='row']")).toHaveCount(2);
    await expect(page.locator("[data-table-toggle='col']")).toHaveCount(2);
    await expect(page.locator("[data-table-toggle='row']").first()).toHaveAttribute(
      "aria-label",
      "Row 1 actions",
    );
    await expect(page.locator("[data-table-toggle='col']").first()).toHaveAttribute(
      "aria-label",
      "Column 1 actions",
    );

    // 行手柄 → 在上方插入行：在第 0 行上方插入空行（单空格占位），源码其余部分不动。
    await page.locator("[data-table-toggle='row']").first().click();
    await expect(page.locator(".cm-md-table-widget__menu")).toBeVisible();
    await expect(page.locator(".cm-md-table-widget__menu")).toHaveAttribute("role", "menu");
    await expect(page.locator(".cm-md-table-widget__menu")).toHaveAttribute(
      "aria-label",
      "Table actions",
    );
    await page.locator("[data-table-action='insert-row-above']").click();
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace(
          TABLE_BLOCK,
          "| Header A | Header B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |",
        ),
      );
    await expect(page.locator("tbody tr")).toHaveCount(3);

    // 行手柄 → 删除本行（删除最后一行）。
    await widget(page).hover();
    await page.locator("[data-table-toggle='row']").last().click();
    await page.locator("[data-table-action='delete-row']").click();
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace(
          TABLE_BLOCK,
          "| Header A | Header B |\n| --- | --- |\n|  |  |\n| 1 | 2 |",
        ),
      );
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // 列手柄 → 在右侧插入列（插到第 0 列之后）。
    await widget(page).hover();
    await page.locator("[data-table-toggle='col']").first().click();
    await page.locator("[data-table-action='insert-col-right']").click();
    await expect(page.locator("thead th")).toHaveCount(3);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace(
          TABLE_BLOCK,
          "| Header A |  | Header B |\n| --- | --- | --- |\n|  |  |  |\n| 1 |  | 2 |",
        ),
      );

    // 列手柄 → 删除本列（删除刚插入的空列，即第 1 列）。
    await widget(page).hover();
    await page.locator("[data-table-toggle='col']").nth(1).click();
    await page.locator("[data-table-action='delete-col']").click();
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace(
          TABLE_BLOCK,
          "| Header A | Header B |\n| --- | --- |\n|  |  |\n| 1 | 2 |",
        ),
      );

    // 列手柄 → 对齐切换：第一列居中 → delimiter 重写为 :---:。
    await widget(page).hover();
    await page.locator("[data-table-toggle='col']").first().click();
    await expect(page.locator("[data-table-action='align-center']")).toHaveCount(1);
    await page.locator("[data-table-action='align-center']").click();
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        TABLE_MARKDOWN.replace(
          TABLE_BLOCK,
          "| Header A | Header B |\n| :---: | --- |\n|  |  |\n| 1 | 2 |",
        ),
      );
  });

  test("B5: whole-table atom selection deletes exactly and restores on undo", async ({ page }) => {
    await loadTable(page, TABLE_MARKDOWN);

    // 光标在表格上方一行，按两次 ArrowDown 进入表格块 → 整表原子选中。
    // （第一次 ArrowDown 落到表格上方空行，第二次才进入表格块。）
    await clickLineText(page, lineWithText(page, "Before table."), "Before table.");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(widget(page)).toHaveAttribute("aria-selected", "true");
    await expect(widget(page)).toHaveClass(/cm-md-table-widget--selected/u);

    const selected = await diagnostics(page);
    expect(selected.renderer).toMatchObject({
      selectionAnchor: TABLE_MARKDOWN.indexOf(TABLE_BLOCK),
      selectionHead: TABLE_MARKDOWN.indexOf(TABLE_BLOCK) + TABLE_BLOCK.length,
    });

    // Delete 整表删除、undo 完整恢复。
    await page.locator(".cm-content").press("Delete");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN.replace(TABLE_BLOCK, ""));
    await expect(widget(page)).toHaveCount(0);
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN);
    await expect(widget(page)).toHaveCount(1);
  });

  test("B5b: atom-selected table is equivalently replaced by typing or pasting", async ({
    page,
  }) => {
    await loadTable(page, TABLE_MARKDOWN);

    // 打字等价替换。
    await clickLineText(page, lineWithText(page, "Before table."), "Before table.");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(widget(page)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.type("replacement");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN.replace(TABLE_BLOCK, "replacement"));
    await expect(widget(page)).toHaveCount(0);
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN);

    // 粘贴等价替换。
    await clickLineText(page, lineWithText(page, "Before table."), "Before table.");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(widget(page)).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => navigator.clipboard.writeText("pasted"));
    await page.locator(".cm-content").press(PASTE_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN.replace(TABLE_BLOCK, "pasted"));
    await expect(widget(page)).toHaveCount(0);
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(TABLE_MARKDOWN);
  });

  test("B6: Enter on the last body row exits the table and continues in a new paragraph", async ({
    page,
  }) => {
    await loadTable(page, TABLE_MARKDOWN);

    const last = bodyCell(page, 1, 1);
    await last.click();
    // End 到行尾后追加，最后一行 Enter：提交并退出表格、新增段落续写正文。
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await page.keyboard.press("Enter");
    // 提交最后一行，并在表格下方新增段落续写正文：
    // 终止空行保留，其后补“新空行 + 分隔空行”，光标落到新空行上。
    const afterEnter = TABLE_MARKDOWN.replace("| 3 | 4 |", "| 3 | 4x |").replace(
      "\n\nAfter table.",
      "\n\n\n\nAfter table.",
    );
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(afterEnter);
    await page.keyboard.type("Tail");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(
        [
          "Before table.",
          "",
          "| Header A | Header B |",
          "| --- | --- |",
          "| 1 | 2 |",
          "| 3 | 4x |",
          "",
          "Tail",
          "",
          "After table.",
          "",
        ].join("\n"),
      );
  });

  test("B7: footnote inside a cell stays literal while outside footnotes stay source-only", async ({
    page,
  }) => {
    await loadTable(page, BOUNDARY_MARKDOWN);

    // 表内 [^inner]：只作为单元格文本呈现，不在表格内渲染为默认 atom。
    await expect(page.locator(".cm-md-table-widget__cell", { hasText: "[^inner]" })).toHaveCount(1);
    await expect(page.locator(".cm-md-table-widget .cm-md-default-atom")).toHaveCount(0);

    // 表外 [^outside]：引用与定义都是 source-only 默认 atom（共 2 个，引用在前）。
    const footnotes = page.locator('.cm-md-default-atom[data-syntax-kind="footnote"]');
    await expect(footnotes).toHaveCount(2);
    const outside = footnotes.first();
    // 默认 atom 只显示 label（"[^outside]" 前缀之后的部分），源码仍保留在文档中。
    await expect(outside).toHaveText("outside");
    const rejectionCount = (await diagnostics(page)).renderer!.wysiwyg
      .protectedChangeRejectionCount;
    const from = BOUNDARY_MARKDOWN.indexOf("[^outside]");
    await outside.click();
    await expect(outside).toHaveAttribute("aria-selected", "true");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: from,
      selectionHead: from + "[^outside]".length,
    });
    await page.locator(".cm-content").press("Delete");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: from,
      selectionHead: from + "[^outside]".length,
      markdown: BOUNDARY_MARKDOWN,
    });
    expect((await diagnostics(page)).renderer!.wysiwyg.protectedChangeRejectionCount).toBe(
      rejectionCount + 1,
    );
    await expect(page.locator(".cm-announced")).toContainText(
      "This Markdown syntax can only be edited in source mode.",
    );

    // 表格本体不受影响：仍在、单元格文本保持字面量。
    await expect(page.locator(".cm-md-table-widget__cell", { hasText: "[^inner]" })).toHaveCount(1);
  });
});

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
}

async function diagnostics(page: Page) {
  return page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
}

function lineWithText(page: Page, text: string) {
  return page.locator(".cm-line").filter({ hasText: text }).first();
}

async function clickLineText(page: Page, line: ReturnType<typeof lineWithText>, text: string) {
  const point = await line.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node as Text);
      node = walker.nextNode();
    }
    const content = nodes.map((textNode) => textNode.data).join("");
    const targetOffset = content.indexOf(target);
    if (targetOffset >= 0) {
      const midpoint = targetOffset + Math.floor(target.length / 2);
      let consumed = 0;
      for (const textNode of nodes) {
        if (midpoint <= consumed + textNode.data.length) {
          const offset = Math.min(midpoint - consumed, textNode.data.length);
          const range = document.createRange();
          range.setStart(textNode, offset);
          range.setEnd(textNode, Math.min(offset + 1, textNode.data.length));
          const rect = range.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        consumed += textNode.data.length;
      }
    }
    return null;
  }, text);
  if (!point) {
    throw new Error(`Editable text must be rendered before clicking: ${text}`);
  }
  await page.mouse.click(point.x, point.y);
}
