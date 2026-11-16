import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const startingMarkdown = "Before\n\nAfter";

async function openApp(page: Page, markdown = startingMarkdown): Promise<void> {
  await page.addInitScript((draft) => {
    if (sessionStorage.getItem("md-editor:e2e-seeded") === "1") return;
    sessionStorage.setItem("md-editor:e2e-seeded", "1");
    localStorage.setItem("md-editor:web:draft", draft);
    localStorage.setItem(
      "md-editor:web:settings",
      JSON.stringify({ language: "zh", theme: "light" }),
    );
    window.prompt = () => {
      throw new Error("Graphical diagram editing must not use a native prompt");
    };
  }, markdown);
  await page.goto(".");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
}

async function readMarkdown(page: Page): Promise<string> {
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.locator(".cm-content").first();
  await expect(source).toBeVisible();
  return (await source.locator(".cm-line").allInnerTexts()).join("\n").replace(/\n+$/, "");
}

async function openCreation(page: Page, label: string): Promise<void> {
  await page.locator('summary[aria-label="插入图表"]').click();
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByRole("dialog", { name: "新建图表" })).toBeVisible();
}

async function enterWysiwyg(page: Page): Promise<void> {
  await page.getByRole("button", { name: "所见即所得", exact: true }).click();
}

async function openGraphicalEditor(page: Page, blockIndex = 0): Promise<void> {
  const block = page.locator(".cm-md-mermaid-block").nth(blockIndex);
  await block.hover();
  const button = block.getByRole("button", { name: "图形编辑图表", exact: true });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
}

async function submitToolInput(
  page: Page,
  buttonName: string,
  fields: readonly { label: string; value: string }[],
): Promise<void> {
  const toolbar = page.getByRole("navigation", { name: /编辑工具$/ });
  await toolbar.getByRole("button", { name: buttonName, exact: true }).click();
  for (const { label, value } of fields) {
    const input = page.getByLabel(label, { exact: true });
    await expect(input).toBeVisible();
    if (await input.evaluate((element) => element.tagName === "SELECT")) {
      await input.selectOption({ label: value });
    } else {
      await input.fill(value);
    }
  }
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".cm-md-mermaid-graphical-input")).toHaveCount(0);
}

test("canceling either new diagram leaves the document unchanged and restores menu focus", async ({
  page,
}) => {
  await openApp(page);
  const originalMarkdown = await readMarkdown(page);
  await page.getByRole("button", { name: "所见即所得", exact: true }).click();
  for (const label of ["新建 Mermaid 流程图", "新建 Mermaid 时序图"]) {
    await openCreation(page, label);
    const dialog = page.getByRole("dialog", { name: "新建图表" });
    await expect(dialog).toContainText("应用");
    await expect(dialog).toContainText("取消");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('summary[aria-label="插入图表"]')).toBeFocused();
    const unchangedMarkdown = await readMarkdown(page);
    expect(unchangedMarkdown).toBe(originalMarkdown);
    await page.getByRole("button", { name: "所见即所得", exact: true }).click();
  }
});

test("the diagram dialog keeps background editing inert and restores focus after Escape", async ({
  page,
}) => {
  await openApp(page);
  const originalMarkdown = await readMarkdown(page);
  await enterWysiwyg(page);
  const editor = page.locator(".cm-content").first();
  const editorText = await editor.innerText();
  const insertMenu = page.locator('summary[aria-label="插入图表"]');
  await openCreation(page, "新建 Mermaid 流程图");
  const dialog = page.getByRole("dialog", { name: "新建图表" });
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest("dialog") !== null))
    .toBe(true);

  const editorBox = await editor.boundingBox();
  if (editorBox === null)
    throw new Error("Expected the background editor to have a clickable area");
  await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2);
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest("dialog") !== null))
    .toBe(true);
  expect(await editor.innerText()).toBe(editorText);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(insertMenu).toBeFocused();
  expect(await readMarkdown(page)).toBe(originalMarkdown);
});

test("IME composition Enter does not submit a diagram input form", async ({ page }) => {
  await openApp(page);
  await openCreation(page, "新建 Mermaid 流程图");
  const dialog = page.getByRole("dialog", { name: "新建图表" });
  const apply = dialog.getByRole("button", { name: "应用" });
  const draftBeforeInput = await page.evaluate(() => localStorage.getItem("md-editor:web:draft"));
  await page
    .getByRole("navigation", { name: "流程图编辑工具" })
    .getByRole("button", { name: "添加节点" })
    .click();
  const field = page.getByLabel("节点文字", { exact: true });
  await field.fill("Alpha");
  await expect(apply).toBeDisabled();

  await field.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "あ" }));
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    element.dispatchEvent(composingEnter);
    const legacyImeEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacyImeEnter, "keyCode", { value: 229 });
    element.dispatchEvent(legacyImeEnter);
  });

  await expect(field).toBeVisible();
  await expect(field).toHaveValue("Alpha");
  await expect(apply).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("md-editor:web:draft"))).toBe(
    draftBeforeInput,
  );

  await field.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "あ" }));
  });
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(apply).toBeEnabled();
  await apply.click();
  const markdown = await readMarkdown(page);
  expect(markdown).toContain("n1[Alpha]");
  expect(markdown).toContain("Before");
  expect(markdown).toContain("After");
});

test("creating a flowchart applies one undoable fenced block", async ({ page }) => {
  await openApp(page);
  await openCreation(page, "新建 Mermaid 流程图");
  await submitToolInput(page, "添加节点", [{ label: "节点文字", value: "Alpha" }]);
  await submitToolInput(page, "添加节点", [{ label: "节点文字", value: "Beta" }]);
  await submitToolInput(page, "连接节点", [
    { label: "起点节点", value: "Alpha" },
    { label: "终点节点", value: "Beta" },
  ]);
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page.getByRole("dialog", { name: "新建图表" })).toHaveCount(0);
  let markdown = await readMarkdown(page);
  expect(markdown).toContain("flowchart TD");
  expect(markdown).toContain("n1[Alpha]");
  expect(markdown).toContain("n2[Beta]");
  expect(markdown).toContain("n1 --> n2");
  expect(markdown).toContain("Before");
  expect(markdown).toContain("After");

  const source = page.locator(".cm-content").first();
  await source.focus();
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+z`);
  await expect(source).not.toContainText("flowchart TD");
  await expect(source).toContainText("Before");
  await expect(source).toContainText("After");
  await page.keyboard.press(modifier === "Meta" ? "Meta+Shift+z" : "Control+y");
  await expect(source).toContainText("flowchart TD");
  markdown = await source.innerText();
  expect(markdown).toContain("n1 --> n2");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("md-editor:web:draft") ?? ""))
    .toContain("flowchart TD");
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  expect(await readMarkdown(page)).toContain("n1 --> n2");
});

test("creating a sequence diagram preserves participant and message semantics", async ({
  page,
}) => {
  await openApp(page);
  await openCreation(page, "新建 Mermaid 时序图");
  await submitToolInput(page, "添加参与者", [{ label: "参与者名称", value: "A" }]);
  await submitToolInput(page, "添加参与者", [{ label: "参与者名称", value: "B" }]);
  await submitToolInput(page, "添加消息", [
    { label: "发送方", value: "A" },
    { label: "接收方", value: "B" },
    { label: "消息文字", value: "Request" },
  ]);
  await page.getByRole("button", { name: "应用" }).click();
  const markdown = await readMarkdown(page);
  expect(markdown).toContain("sequenceDiagram");
  expect(markdown).toContain("participant A");
  expect(markdown).toContain("participant B");
  expect(markdown).toContain("A->>B: Request");
  expect(markdown).toContain("Before");
  expect(markdown).toContain("After");
  const source = page.locator(".cm-content").first();
  await source.focus();
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+z`);
  await expect(source).not.toContainText("sequenceDiagram");
  await page.keyboard.press(modifier === "Meta" ? "Meta+Shift+z" : "Control+y");
  await expect(source).toContainText("sequenceDiagram");
});

test("an existing Mermaid block offers exactly view and edit while source mode remains available", async ({
  page,
}, testInfo) => {
  const markdown = "Before\n\n```mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n```\n\nAfter";
  await openApp(page, markdown);
  await enterWysiwyg(page);
  const diagram = page.locator(".cm-md-mermaid-container");
  await expect(diagram.locator("svg")).toBeVisible({ timeout: 20_000 });
  await diagram.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mermaid-read-only-viewer.png") });
  await testInfo.attach("mermaid-read-only-viewer.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const actions = page.locator(".cm-md-mermaid-toolbar button");
  await expect(actions).toHaveText(["查看", "编辑"]);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.locator(".cm-content").first();
  await expect(source).toContainText("flowchart TD");
  await expect(source).toContainText("Before");
  await expect(source).toContainText("After");
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 760, height: 520 },
]) {
  test(`diagram controls keep the canvas clear at ${viewport.width} x ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    // The host replaces its mode switch with a compact menu in narrow windows.
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(
      page,
      "Before\n\n```mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n  A --> C[Gamma]\n  B --> D[Done]\n  C --> D\n```\n\nAfter",
    );
    if (viewport.width === 760) await page.getByRole("button", { name: "切换为深色模式" }).click();
    await enterWysiwyg(page);
    if (viewport.width === 760) await page.getByRole("button", { name: /收起侧边栏/ }).click();
    await page.setViewportSize(viewport);
    await openGraphicalEditor(page);
    const dialog = page.getByRole("dialog", { name: "编辑图表" });
    const toolbar = dialog.getByRole("navigation", { name: "流程图编辑工具" });
    const visibleActions = toolbar.locator(
      ".cm-md-mermaid-graphical-toolbar__actions button:visible",
    );
    await expect(visibleActions).toHaveText(["添加节点", "连接节点"]);
    const canvas = dialog.locator(".mw-canvas");
    const assertClearCanvas = async () => {
      const bar = (await toolbar.boundingBox())!;
      const area = (await canvas.boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + 1);
      expect(area.height).toBeGreaterThan(150);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    };
    await assertClearCanvas();
    const node = dialog.locator('[data-mw-entity="node:A"]').first();
    await node.click();
    await expect(visibleActions).toHaveText(["添加节点", "连接节点", "修改节点文字", "删除节点"]);
    await toolbar.getByRole("button", { name: "连接节点", exact: true }).click();
    await expect(page.getByLabel("起点节点", { exact: true })).toHaveValue("A");
    await expect(page.getByLabel("终点节点", { exact: true })).toBeVisible();
    await assertClearCanvas();
    const labelBox = (await node.locator(".nodeLabel").boundingBox())!;
    expect(labelBox.height).toBeGreaterThanOrEqual(11);
    await page.screenshot({ path: testInfo.outputPath(`diagram-controls-${viewport.width}.png`) });
    // Escape dismisses the pending form first and returns to the same selected entity.
    await page.keyboard.press("Escape");
    await expect(dialog.locator(".cm-md-mermaid-graphical-input")).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "连接节点", exact: true })).toBeFocused();
    await expect(toolbar.getByRole("button", { name: "修改节点文字", exact: true })).toBeVisible();
    await toolbar.getByRole("button", { name: "修改节点文字", exact: true }).click();
    await expect(page.getByLabel("节点文字", { exact: true })).toHaveValue("Alpha");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

test("a flow node cannot be deleted by toolbar or keyboard while an edge references it", async ({
  page,
}) => {
  await openApp(page, "Before\n\n```mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n```\n\nAfter");
  await enterWysiwyg(page);
  await openGraphicalEditor(page);
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  const node = dialog.locator('[data-mw-entity="node:A"]').first();
  await expect(node).toBeVisible({ timeout: 20_000 });
  await node.click();
  const draftBeforeBlockedDelete = await page.evaluate(() =>
    localStorage.getItem("md-editor:web:draft"),
  );
  const nativeDelete = dialog.locator('.mw-popover button[title="Delete"]');
  await expect(nativeDelete).toBeHidden();
  await expect(dialog.locator('[data-mw-entity="node:A"]').first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("md-editor:web:draft")))
    .toBe(draftBeforeBlockedDelete);
  const deleteNode = dialog.getByRole("button", { name: "删除节点", exact: true });
  await expect(deleteNode).toBeDisabled();
  await expect(deleteNode).toHaveAttribute("title", "请先删除引用此节点的关系或样式");
  await page.keyboard.press("Delete");
  await expect(dialog.locator('[data-mw-entity="node:A"]').first()).toBeVisible();

  await dialog.locator('[data-mw-entity^="edge:"]').first().click({ force: true });
  const deleteEdge = dialog.getByRole("button", { name: "删除关系", exact: true });
  await expect(deleteEdge).toBeEnabled();
  await deleteEdge.click();
  await expect(dialog.locator('[data-mw-entity^="edge:"]')).toHaveCount(0);
  await dialog.locator('[data-mw-entity="node:A"]').first().click();
  await expect(deleteNode).toBeEnabled();
  await deleteNode.click();
  await expect(dialog.locator('[data-mw-entity="node:A"]')).toHaveCount(0);
});

test("a sequence participant cannot be deleted while a message references it", async ({ page }) => {
  await openApp(
    page,
    "Before\n\n```mermaid\nsequenceDiagram\n  participant A\n  participant B\n  A->>B: Request\n```\n\nAfter",
  );
  await enterWysiwyg(page);
  await openGraphicalEditor(page);
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  const participant = dialog.locator('[data-mw-entity="participant:A"]').first();
  await expect(participant).toBeVisible({ timeout: 20_000 });
  await participant.click();
  const draftBeforeBlockedDelete = await page.evaluate(() =>
    localStorage.getItem("md-editor:web:draft"),
  );
  const nativeDelete = dialog.locator('.mw-popover button[title="Delete"]');
  await expect(nativeDelete).toBeHidden();
  await expect(dialog.locator('[data-mw-entity="participant:A"]').first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("md-editor:web:draft")))
    .toBe(draftBeforeBlockedDelete);
  const deleteParticipant = dialog.getByRole("button", { name: "删除参与者", exact: true });
  await expect(deleteParticipant).toBeDisabled();
  await expect(deleteParticipant).toHaveAttribute("title", "请先删除引用此参与者的消息或注释");
  await page.keyboard.press("Backspace");
  await expect(dialog.locator('[data-mw-entity="participant:A"]').first()).toBeVisible();

  await dialog.locator('[data-mw-entity^="event:"]').first().click({ force: true });
  const deleteMessage = dialog.getByRole("button", { name: "删除消息", exact: true });
  await expect(deleteMessage).toBeEnabled();
  await deleteMessage.click();
  await expect(dialog.locator('[data-mw-entity^="event:"]')).toHaveCount(0);
  await dialog.locator('[data-mw-entity="participant:A"]').first().click();
  await expect(deleteParticipant).toBeEnabled();
  await deleteParticipant.click();
  await expect(dialog.locator('[data-mw-entity="participant:A"]')).toHaveCount(0);
});

test("editing a supported existing diagram preserves surrounding Markdown bytes", async ({
  page,
}) => {
  const outsidePrefix = "Prefix  with   spacing\n\n";
  const outsideSuffix = "\n\nSuffix\twith spacing";
  await openApp(
    page,
    `${outsidePrefix}\`\`\`mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n\`\`\`${outsideSuffix}`,
  );
  await enterWysiwyg(page);
  await openGraphicalEditor(page);
  await expect(page.getByRole("dialog", { name: "编辑图表" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.locator(".node").filter({ hasText: "Alpha" }).first()).toBeVisible();
  await dialog.locator(".node").filter({ hasText: "Alpha" }).first().click();
  await submitToolInput(page, "修改节点文字", [{ label: "节点文字", value: "Renamed" }]);
  await page.getByRole("button", { name: "应用" }).click();
  const updated = await readMarkdown(page);
  expect(updated).toContain("A[Renamed]");
  expect(updated.startsWith(outsidePrefix)).toBe(true);
  expect(updated.endsWith(outsideSuffix)).toBe(true);
  const source = page.locator(".cm-content").first();
  await source.focus();
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+z`);
  await expect(source).toContainText("A[Alpha]");
  await expect(source).not.toContainText("A[Renamed]");
  await page.keyboard.press(modifier === "Meta" ? "Meta+Shift+z" : "Control+y");
  await expect(source).toContainText("A[Renamed]");
  expect(await source.innerText()).toContain(outsidePrefix.trimEnd());
  expect(await source.innerText()).toContain(outsideSuffix.trimStart());
});

test("editing the second of two identical Mermaid blocks leaves the first block unchanged", async ({
  page,
}) => {
  const firstBlock = "```mermaid\nflowchart TD\n  A[Same] --> B[End]\n```";
  const middle = "\n\nMiddle\n\n";
  await openApp(page, `Before\n\n${firstBlock}${middle}${firstBlock}\n\nAfter`);
  await enterWysiwyg(page);
  await openGraphicalEditor(page, 1);
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  await submitToolInput(page, "添加节点", [{ label: "节点文字", value: "Only second" }]);
  await page.getByRole("button", { name: "应用" }).click();
  const markdown = await readMarkdown(page);
  const blocks = [...markdown.matchAll(/```mermaid\n[\s\S]*?\n```/g)];
  expect(blocks).toHaveLength(2);
  expect(blocks[0]?.[0]).toBe(firstBlock);
  expect(blocks[1]?.[0]).toContain("A[Same] --> B[End]");
  expect(blocks[1]?.[0]).toContain("Only second");
  expect(markdown).toContain("Before");
  expect(markdown).toContain("Middle");
  expect(markdown).toContain("After");
  await expect(dialog).toHaveCount(0);
});

test("multiple Mermaid blocks keep SVG renders and update with the selected theme", async ({
  page,
}, testInfo) => {
  await openApp(
    page,
    "Before\n\n```mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n```\n\nMiddle\n\n```mermaid\nsequenceDiagram\n  participant A\n  participant B\n  A->>B: Request\n```\n\nAfter",
  );
  await enterWysiwyg(page);
  const diagrams = page.locator(".cm-md-mermaid-container");
  await expect(diagrams).toHaveCount(2);
  await expect(diagrams.nth(0).locator("svg")).toBeVisible({ timeout: 20_000 });
  await expect(diagrams.nth(1).locator("svg")).toBeVisible({ timeout: 20_000 });
  const nodeFill = diagrams.nth(0).locator("svg g.node rect").first();
  const lightFill = await nodeFill.evaluate((element) => getComputedStyle(element).fill);
  await testInfo.attach("mermaid-light-multiple.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.screenshot({ path: testInfo.outputPath("mermaid-light-multiple.png") });

  await page.getByRole("button", { name: "切换为深色模式" }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.themeScheme))
    .toBe("dark");
  await expect
    .poll(() => nodeFill.evaluate((element) => getComputedStyle(element).fill))
    .not.toBe(lightFill);
  await expect(diagrams.nth(0).locator("svg")).toBeVisible();
  await expect(diagrams.nth(1).locator("svg")).toBeVisible();
  await testInfo.attach("mermaid-dark-multiple.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.screenshot({ path: testInfo.outputPath("mermaid-dark-multiple.png") });
});

test("offline diagram creation still applies to local Markdown", async ({ page }) => {
  await openApp(
    page,
    "Before\n\n```mermaid\nflowchart TD\n  A[Ready] --> B[Diagram]\n```\n\nAfter",
  );
  await enterWysiwyg(page);
  await expect(page.locator(".cm-md-mermaid-container svg")).toBeVisible({ timeout: 20_000 });
  await page.context().setOffline(true);
  await openCreation(page, "新建 Mermaid 流程图");
  await submitToolInput(page, "添加节点", [{ label: "节点文字", value: "Local" }]);
  await page.getByRole("button", { name: "应用" }).click();
  const markdown = await readMarkdown(page);
  expect(markdown).toContain("flowchart TD");
  expect(markdown).toContain("n1[Local]");
  expect(markdown).toContain("Before");
  expect(markdown).toContain("After");
});

test("Markdown export retains Mermaid fenced source", async ({ page }, testInfo) => {
  await openApp(page, "Before\n\n```mermaid\nflowchart TD\n  A[Alpha] --> B[Beta]\n```\n\nAfter");
  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error("Markdown export did not create a download");
  const exported = await readFile(path, "utf8");
  await testInfo.attach("exported-mermaid.md", { body: exported, contentType: "text/markdown" });
  expect(exported).toContain("```mermaid");
  expect(exported).toContain("A[Alpha] --> B[Beta]");
});
