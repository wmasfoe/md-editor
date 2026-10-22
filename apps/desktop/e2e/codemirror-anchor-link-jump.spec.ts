import { expect, test, type Page } from "@playwright/test";
import { MOD_KEY, loadDoc, openFullApp, readDoc, setCaret } from "./editor-e2e-helpers";

/**
 * 属主报告：在所见即所得模式手工输入目录（锚点链接）后，
 * Cmd/Ctrl+左击目录项无法跳转，并弹出「无法打开链接：#…」。
 *
 * 真实文档里的锚点由 TOC 生成器/人工撰写，对 `、：（）➔` 等标点的处理
 * 与仓库既有的 slugify 不一致（有的转 `-`，有的直接丢弃），
 * 因此锚点解析必须容忍这些差异，而不是只做 `id === fragment` 精确匹配。
 */
const TOC_DOCUMENT = [
  "1. [全景搭配图](#一-全景搭配图这些-skills-怎么组合最爽)",
  "2. [短剧全流程](#二-第一类短剧全流程导演与制片-skills剧本--分镜--视频--成片)",
  "",
  "## 一、全景搭配图：这些 Skills 怎么组合最爽？",
  "",
  "第一节正文",
  "",
  "## 二、第一类：短剧全流程导演与制片 Skills（剧本 ➔ 分镜 ➔ 视频 ➔ 成片）",
  "",
  "第二节正文",
  "",
].join("\n");

const HEADING_ONE = "## 一、全景搭配图：这些 Skills 怎么组合最爽？";
const HEADING_TWO = "## 二、第一类：短剧全流程导演与制片 Skills（剧本 ➔ 分镜 ➔ 视频 ➔ 成片）";

async function selectionHead(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__MD_EDITOR_E2E__!.getDiagnostics().renderer?.selectionHead ?? -1,
  );
}

async function commandClickLink(page: Page, linkIndex: number): Promise<void> {
  await page
    .locator(".cm-md-link")
    .nth(linkIndex)
    .click({ modifiers: [MOD_KEY === "Meta" ? "Meta" : "Control"] });
}

test.describe("锚点链接跳转 (Anchor Link Jump)", () => {
  test("A1: Cmd/Ctrl+点击手工目录项，跳转到对应标题且不报错", async ({ page }) => {
    await openFullApp(page);
    await loadDoc(page, TOC_DOCUMENT);
    expect(await readDoc(page), "前置：文档已装载").toBe(TOC_DOCUMENT);

    const target = TOC_DOCUMENT.indexOf(HEADING_ONE);
    expect(target, "前置：目标标题存在").toBeGreaterThan(0);

    await commandClickLink(page, 0);

    await expect
      .poll(() => selectionHead(page), { message: "锚点链接必须把光标定位到标题行" })
      .toBe(target);
    await expect(page.locator("[role='alert']")).toHaveCount(0);
    expect(await readDoc(page), "跳转不得改动文档").toBe(TOC_DOCUMENT);
  });

  test("A2: TOC 标点策略与仓库 slugify 不一致时（➔/双连字符）仍可跳转", async ({ page }) => {
    await openFullApp(page);
    await loadDoc(page, TOC_DOCUMENT);

    const target = TOC_DOCUMENT.indexOf(HEADING_TWO);
    expect(target, "前置：目标标题存在").toBeGreaterThan(0);

    await commandClickLink(page, 1);

    await expect.poll(() => selectionHead(page)).toBe(target);
    await expect(page.locator("[role='alert']")).toHaveCount(0);
  });

  test("A3: 目标标题不存在时给出明确提示且不移动光标", async ({ page }) => {
    await openFullApp(page);
    const markdown = ["[坏链接](#不存在的标题)", "", "## 真实标题", ""].join("\n");
    await loadDoc(page, markdown);

    const before = await selectionHead(page);
    await commandClickLink(page, 0);

    await expect(page.locator("[role='alert']")).toContainText("没有找到标题 #不存在的标题");
    expect(await selectionHead(page), "未命中锚点不得移动光标").toBe(before);
    expect(await readDoc(page)).toBe(markdown);
  });

  test("A4: 空片段链接（回到顶部）滚回文档开头", async ({ page }) => {
    await openFullApp(page);
    const markdown = ["[回到顶部](#)", "", "## 标题 A", "", "正文", ""].join("\n");
    await loadDoc(page, markdown);
    await setCaret(page, markdown.indexOf("正文"));

    await commandClickLink(page, 0);

    await expect.poll(() => selectionHead(page)).toBe(0);
    await expect(page.locator("[role='alert']")).toHaveCount(0);
    expect(await readDoc(page)).toBe(markdown);
  });
});
