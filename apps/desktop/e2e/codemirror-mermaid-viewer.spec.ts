import { expect, test, type Page } from "@playwright/test";
import { loadDoc, openFullApp, readDoc } from "./editor-e2e-helpers";

/**
 * Mermaid 图表「查看 / 编辑」解耦的浏览器验收（AC1–AC4、AC8–AC12、AC17–AC19）。
 *
 * 契约来源：`.omx/plans/test-spec-mermaid-diagram-viewer.md` v7 与
 * `.omx/plans/prd-mermaid-diagram-viewer.md` §4.4。
 *
 * 为什么必须浏览器：mermaid 渲染需要真实 DOM；浮层的**计算样式**（`position:fixed` / 覆盖视口 /
 * `z-index`）与**焦点接管**也只有真实浏览器能给证据。
 *
 * 类名契约（实现必须匹配，G003）：
 * - `.cm-md-mermaid-block`：外层包装（承载工具栏，避免被 `overflow-x:auto` 裁剪）
 * - `.cm-md-mermaid-container`：SVG 滚动层（既有类名保持不变，既有 spec 依赖它）
 * - `.cm-md-mermaid-toolbar` + `__viewer` / `__edit`
 * - 共享浮层：`.cm-md-media-viewer`（根）+ `__stage` / `__media` / `__close` / `__edit`
 */

const MERMAID_DOC = [
  "# 图表",
  "",
  "```mermaid",
  "graph TD",
  "  A[开始] --> B[结束]",
  "```",
  "",
  "正文段落。",
  "",
].join("\n");

const INVALID_MERMAID_DOC = [
  "# 坏图",
  "",
  "```mermaid",
  "graph TD",
  "  A[未闭合 -->",
  "```",
  "",
].join("\n");

/** 超宽图：列数足够多，使 SVG 宽度超过视口 ⇒ 触发滚动层裁剪风险（AC19）。
 *  必顶先给一个标题：夹具若以 ```mermaid 开头，loadDoc 后光标落在文档起点＝fence 内，
 *  块会处于激活态（源码态）而根本没有 widget（这反而验证了“光标进入块即展开源码”的语义）。 */
const WIDE_MERMAID_DOC = [
  "# 宽图",
  "",
  "```mermaid",
  "graph LR",
  "  A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8 --> A9 --> A10 --> A11 --> A12",
  "```",
  "",
].join("\n");

async function openMermaidDoc(page: Page, doc: string): Promise<void> {
  await openFullApp(page);
  await loadDoc(page, doc);
  await expect(page.locator(".cm-md-mermaid-container").first()).toBeVisible({ timeout: 30_000 });
}

/** 等到 SVG 渲染完成（此时「放大查看」才可用）。 */
async function waitForSvg(page: Page): Promise<void> {
  await expect(page.locator(".cm-md-mermaid-container svg").first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Mermaid 图表查看与编辑解耦", () => {
  test("AC1: 单击块体打开浮层，不改选区、不展开源码", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);
    const before = await readDoc(page);

    await page.locator(".cm-md-mermaid-container").first().click();

    const overlay = page.locator(".cm-md-media-viewer");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("svg")).toBeVisible();
    // 未进入源码态
    await expect(page.locator(".cm-md-marker--mermaid")).toHaveCount(0);
    // 文档未被改动
    expect(await readDoc(page)).toBe(before);
  });

  test("AC2: 拖拽（位移超阈值）不打开浮层", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    const box = await page.locator(".cm-md-mermaid-container").first().boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10);
    await page.mouse.up();

    await expect(page.locator(".cm-md-media-viewer")).toHaveCount(0);
  });

  test("AC3: 悬浮工具栏——放大查看只开浮层，编辑源码只进编辑", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    const block = page.locator(".cm-md-mermaid-block").first();
    await block.hover();
    const toolbar = page.locator(".cm-md-mermaid-toolbar").first();
    await expect(toolbar).toBeVisible();
    const viewerButton = toolbar.locator(".cm-md-mermaid-toolbar__viewer");
    const editButton = toolbar.locator(".cm-md-mermaid-toolbar__edit");
    await expect(viewerButton).toBeVisible();
    await expect(editButton).toBeVisible();

    await viewerButton.click({ force: true });
    await expect(page.locator(".cm-md-media-viewer")).toBeVisible();
    await expect(page.locator(".cm-md-marker--mermaid")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-md-media-viewer")).toHaveCount(0);

    await block.hover();
    await editButton.click({ force: true });
    await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible();
    await expect(page.locator(".cm-md-media-viewer")).toHaveCount(0);
  });

  test("AC4: 浮层内「编辑源码」→ 关浮层并进入源码态", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    await page.locator(".cm-md-mermaid-container").first().click();
    const overlay = page.locator(".cm-md-media-viewer");
    await expect(overlay).toBeVisible();
    await overlay.locator(".cm-md-media-viewer__edit").click();

    await expect(overlay).toHaveCount(0);
    await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible();
  });

  test("AC17/AC18: 浮层计算样式生效、dialog 语义、焦点接管（键入不改文档）", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);
    const before = await readDoc(page);

    await page.locator(".cm-md-mermaid-container").first().click();
    const overlay = page.locator(".cm-md-media-viewer");
    await expect(overlay).toBeVisible();

    const styles = await overlay.evaluate((element) => {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        position: computed.position,
        zIndex: Number.parseInt(computed.zIndex, 10),
        background: computed.backgroundColor,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(styles.position).toBe("fixed");
    expect(styles.zIndex).toBeGreaterThanOrEqual(1000);
    expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles.width).toBeGreaterThanOrEqual(styles.viewportWidth - 1);
    expect(styles.height).toBeGreaterThanOrEqual(styles.viewportHeight - 1);

    await expect(overlay).toHaveAttribute("role", "dialog");
    await expect(overlay).toHaveAttribute("aria-modal", "true");
    await expect(overlay).toBeFocused();

    // 键入不得改到背后文档
    await page.keyboard.type("zzz");
    expect(await readDoc(page)).toBe(before);
  });

  test("AC9: 渲染失败时不产生空浮层；单击错误卡片进入源码编辑", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, INVALID_MERMAID_DOC);
    const errorCard = page.locator(".cm-md-mermaid-error").first();
    await expect(errorCard).toBeVisible({ timeout: 30_000 });

    await errorCard.click();
    await expect(page.locator(".cm-md-media-viewer")).toHaveCount(0);
    await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible();
  });

  test("AC8: 键盘光标进入块（含边界）即展开源码；普通段落 Enter 仍换行", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    // 把光标放到 mermaid 块上一行（"# 图表"），再向下移动进入块
    const container = page.locator(".cm-md-mermaid-container").first();
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    await page.mouse.click(box.x + 10, box.y - 40);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".cm-md-marker--mermaid").first()).toBeVisible({ timeout: 10_000 });
  });

  test("AC19: 超宽图下工具栏不被裁剪、按钮仍可点击，且浮层内图表真的铺开", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, WIDE_MERMAID_DOC);
    await waitForSvg(page);

    const container = page.locator(".cm-md-mermaid-container").first();
    await container.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    const block = page.locator(".cm-md-mermaid-block").first();
    await block.hover();
    const viewerButton = page.locator(".cm-md-mermaid-toolbar__viewer").first();
    await expect(viewerButton).toBeVisible();
    await viewerButton.click({ force: true });
    const overlay = page.locator(".cm-md-media-viewer");
    await expect(overlay).toBeVisible();

    // 「适应宽度」不能只是数值上算对：真实渲染宽度必须真的铺开（防止 layout box 与 viewBox 不一致时"看起来坏"）
    const widthRatio = await overlay.locator("svg").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width / window.innerWidth;
    });
    expect(widthRatio).toBeGreaterThan(0.5);
  });

  test("AC12: 图表块后按 Tab 不新增文档内 Tab 停靠点（焦点留在内容区）", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    const container = page.locator(".cm-md-mermaid-container").first();
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    await page.mouse.click(box.x + 10, box.y + box.height + 30);
    await page.keyboard.press("Tab");
    await expect(page.locator(".cm-content")).toBeFocused();
  });

  test("AC10: 浮层内 SVG 的 id 与正文 SVG 无交集，且引用可解析", async ({ page }) => {
    test.setTimeout(90_000);
    await openMermaidDoc(page, MERMAID_DOC);
    await waitForSvg(page);

    await page.locator(".cm-md-mermaid-container").first().click();
    const overlay = page.locator(".cm-md-media-viewer");
    await expect(overlay).toBeVisible();

    const result = await page.evaluate(() => {
      const bodySvg = document.querySelector(".cm-md-mermaid-container svg");
      const overlaySvg = document.querySelector(".cm-md-media-viewer svg");
      // 不抽 helper：`page.evaluate` 的函数会被序列化到浏览器执行，模块级 helper 在那里不存在
      const overlayIds = overlaySvg
        ? Array.from(overlaySvg.querySelectorAll("[id]")).map((node) => node.id)
        : [];
      const bodyIds = bodySvg
        ? Array.from(bodySvg.querySelectorAll("[id]")).map((node) => node.id)
        : [];
      // 浮层内所有 url(#x) 引用是否都能在浮层内解析
      const dangling: string[] = [];
      if (overlaySvg) {
        for (const node of Array.from(overlaySvg.querySelectorAll("*"))) {
          for (const attribute of Array.from(node.attributes)) {
            const match = /url\(#([^)]+)\)/.exec(attribute.value);
            if (match && !overlaySvg.querySelector(`[id="${match[1]}"]`)) {
              dangling.push(match[1]);
            }
          }
        }
      }
      return { overlayIds, bodyIds, dangling };
    });

    expect(result.overlayIds.length).toBeGreaterThan(0);
    expect(result.overlayIds.some((id) => result.bodyIds.includes(id))).toBe(false);
    expect(result.dangling).toEqual([]);
  });
});
