import { expect, test, type Page } from "@playwright/test";
import {
  openFullApp as openApp,
  loadDoc,
  readDoc,
  runCommand,
  setCaret,
} from "./editor-e2e-helpers";

/**
 * E13–E15：D-2 专注模式 / 打字机模式 的 desktop Playwright E2E（test-spec §3）。
 *
 *  - E13 / F2+F1：活动块标记（光标所在 block）+ dim 强度落在 0.30–0.50（默认 0.38）
 *  - E14 / F5    ：原子 widget（表格）在专注模式下**不消失**（F-C 根 class 机制的正面证据）
 *  - E15 / W1+W2 ：打字机阈值防抖（≤0.35×视口高不滚动）+ 超阈值校正到 50%
 *  - E15 / W3    ：输入路径**即时**跟随（禁 smooth —— 单次大输入后短窗内光标即居中）
 *  - E20 / 所有权 ：开启专注后**移动光标**，非活动块仍保持 dim（HIGH-1 回归锁）
 *  - E21 / F5    ：不在旧 kind 名单内的整块 widget（setext/引用定义/脚注定义/表格）
 *                  在专注模式下不消失、不产生幻影行（块级 DOM 结构不变量）
 *
 * 两个模式均经 **G007 命令面板**触发（AC-D2-2 顺带取证：命令面板可搜可执行）。
 * F3（搜索命中对比度）按 §4 降级、W4 显式延期、W5 拆半（滚动校正在本文件 W1/W2 覆盖）。
 */

const FOCUS_DOC = [
  "# 标题块",
  "",
  "段落甲是活动块测试目标。",
  "",
  "段落乙是 dim 测试目标，它在活动块之外，专注模式下应被压暗。",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
  ...Array.from(
    { length: 30 },
    (_, i) => `滚动段落 ${i + 1}：打字机校正与专注模式 E2E 的长文本占位内容。`,
  ),
  "",
].join("\n");

/** E21 夹具：四种整块 replace widget，其中三种**不在**旧 kind 名单内（后者已删除） */ const WIDGET_DOC =
  [
    "Setext 标题",
    "===========",
    "",
    "普通段落，专注模式下应被 dim。",
    "",
    "[ref]: https://example.com/only",
    "",
    "脚注引用示例。[^1]",
    "",
    "[^1]: 脚注定义内容",
    "",
    "| 列一 | 列二 |",
    "| --- | --- |",
    "| 单元 | 数据 |",
    "",
  ].join("\n");

/** E25 夹具：标题在上、表格在下 —— 用于锁定「活动块必须迁移」 */
const STALE_DOC = [
  "### 标题",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
  "尾段",
  "",
].join("\n");

/** E31 夹具：形似属主复现文档的长文（多标题 + 表格 + 代码块 + 长段），用于滚动位置回归锁 */
const SCROLL_DOC = Array.from({ length: 24 }, (_unused, index) => {
  const section = [
    `### 3.${index + 1} 小节：滚动测试 ${index + 1}`,
    "",
    `这是第 ${index + 1} 节的说明段，用于把文档撑长并让快速滚动跨越多个块。`,
    "",
  ];
  if (index % 3 === 0) {
    section.push(
      "| 列一 | 列二 |",
      "| --- | --- |",
      "| 单元 | 数据 |",
      "",
      "```js",
      `console.log("section ${index + 1}");`,
      "```",
      "",
    );
  }
  return section.join("\n");
}).join("\n");

/** contentDOM 的块级结构快照（行 / 非行子元素）——「专注模式不得改变块级 DOM 结构」不变量的观测量 */
function blockStructure(page: Page): Promise<{ total: number; lines: number; widgets: number }> {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    if (!content) {
      return { total: -1, lines: -1, widgets: -1 };
    }
    const children = Array.from(content.children);
    return {
      total: children.length,
      lines: children.filter((element) => element.classList.contains("cm-line")).length,
      widgets: children.filter((element) => !element.classList.contains("cm-line")).length,
    };
  });
}

/** 光标与视口中心的偏差（按 scroller 高度归一化）；光标不可见时返回 999 */
function cursorCenterDelta(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor")?.getBoundingClientRect();
    const scroller = document.querySelector(".cm-scroller")?.getBoundingClientRect();
    if (!cursor || !scroller || scroller.height === 0) {
      return 999;
    }
    return (
      Math.abs(cursor.top + cursor.height / 2 - (scroller.top + scroller.height / 2)) /
      scroller.height
    );
  });
}

/** E37/E38 共用夹具：足够长，可稳定观察滚动动画与抖动 */
const TYPEWRITER_ANIMATION_DOC = [
  "# 标题块",
  "",
  "段落甲。",
  "",
  ...Array.from({ length: 90 }, (_u, i) => `滚动段落 ${i + 1}：打字机滚动动画/抖动观测夹具。`),
  "",
].join("\n");

/** 第 lineNo 行的字符偏移（0 基；夹具行内容仅 ASCII） */
function lineOffsetOf(doc: string, lineNo: number): number {
  const docLines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < lineNo; i += 1) {
    offset += docLines[i].length + 1;
  }
  return offset;
}

test.describe("D-2 专注模式 / 打字机模式（真实 desktop app）", () => {
  test("E13/F2+F1：活动块标记 = 光标所在块；dim 强度落在 0.30–0.50", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    // AC-D2-2 顺带取证：命令面板触发（G007 注册面）
    await runCommand(page, "Focus Mode");

    await expect(page.locator(".cm-md-focus-mode"), "root 标记开启").toHaveCount(1);
    const active = page.locator(".cm-md-focus-active");
    await expect(active, "F2：恰有一个活动块").toHaveCount(1);
    await expect(active, "F2：活动块 = 光标所在块").toContainText("段落甲");

    const dimmed = page.locator(".cm-md-focus-dim").filter({ hasText: "段落乙" }).first();
    await expect(dimmed, "非活动块被 dim 类标记").toHaveCount(1);
    // 120ms 过渡 → 双边界同在一次 poll 内判（先降过 0.5 上限再读会撞过渡中值 0.636 的教训）
    await expect
      .poll(() => dimmed.evaluate((el) => Number(getComputedStyle(el).opacity)), {
        timeout: 2000,
        intervals: [60, 60, 60, 60],
      })
      .toBeLessThanOrEqual(0.5);
    const opacity = await dimmed.evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity, "F1 下限 0.30（默认 0.38）").toBeGreaterThanOrEqual(0.3);
  });

  test("E14/F5：专注模式下原子表格 widget 不消失（根 class 机制）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    await runCommand(page, "Focus Mode");

    const table = page.locator(".cm-md-table-widget");
    await expect(table, "F5/I10：原子 widget 块不得消失").toHaveCount(1);
    await expect(table).toBeVisible();
    // 原子根承载 focus class（ViewPlugin 切换 widget 根，而非外来 decoration 覆盖）
    await expect(table).toHaveClass(/cm-md-focus-(active|dim)/);
  });

  test("E15/S6：光标移动后（无论远近）都居中到视口 50%", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");

    // 远距离跳转 → 居中
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 30"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // 近距离移动（历史上「偏离 ≤0.35×视口高 不滚动」会放过）→ S6 同样必须居中
    // 容差 0.18：未居中时偏差约 0.3–0.5（相邻段落），足以判别
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 25"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // AC-S6-b 第二半「过渡非瞬时」：**如实声明为结构性验证**，不做时序断言。
    // 原因（实测）：本环境下「立即采样」会被 CM 自身的 nearest 滚动与 CDP 采样时序污染
    //（首帧采样常已接近目标 ⇒ 5ms 假绿；慢机上又可能假红），时序断言无法稳定证伪。
    // 结构性依据：`update` 中只有 `docChanged`（输入）走 `immediate`，光标移动/几何变化走
    // `animateTo`（见 typewriter-mode.ts）；`CENTER_ANIMATION_MS` 由 U22 单测守住上界。
    // 若将来要把「动画」做成可运行时证伪，应在模块内暴露帧计数探针（已登记为后续项）。
  });

  test("E29/AC-S6-a：手动滚动不抢、不自动归位（A1，**真实滚轮**）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 10"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // 真实滚轮（关键：直接写 scrollTop 不触发 CM 更新，测不到本路径 —— 属主 #3 就是这个机制）
    const scroller = page.locator(".cm-scroller");
    await scroller.hover();
    for (let index = 0; index < 5; index += 1) {
      await page.mouse.wheel(0, 220);
      await page.waitForTimeout(40);
    }
    const scrolled = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    expect(scrolled, "前提：滚轮确实滚动了").toBeGreaterThan(0);

    // 等待远超缓动时长（140ms）与 rAF 节流的窗口：若实现会「拉回」，这里就会被观测到
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    expect(Math.abs(after - scrolled), "A1：手动滚动后不得被自动拉回").toBeLessThanOrEqual(2);
    // 且光标此时确实偏离中心（证明没有偷偷归位）
    expect(await cursorCenterDelta(page), "A1：手动滚动后光标可离开中心").toBeGreaterThan(0.02);

    // 等滚动惯性落定（落定前的“不抢”是设计行为）：连续两次采样相同才算稳定
    await expect
      .poll(
        async () => {
          const first = await page.evaluate(
            () => document.querySelector(".cm-scroller")!.scrollTop,
          );
          await page.waitForTimeout(120);
          const second = await page.evaluate(
            () => document.querySelector(".cm-scroller")!.scrollTop,
          );
          return Math.abs(second - first);
        },
        { timeout: 3000, intervals: [150, 200, 300] },
      )
      .toBeLessThanOrEqual(2);
    // H-1 回归锁：手动滚动之后**移动光标**仍必须重新居中（且走动画）。
    // 若动画基线使用旧值，会被永久判定为「外部滚动」而放弃 ⇒ 这条会红。
    // 注意：夹具只有「滚动段落 1..30」，写不存在的段落会让 lastIndexOf 返回 -1 ⇒ 光标不动（曾因此假红）
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 29"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);
  });

  test("E33/AC-S1-c：源码模式下专注/打字机仍生效（两轴正交，评审 M-3）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.setMode?.("source"));
    await runCommand(page, "Focus Mode");
    await runCommand(page, "Typewriter Mode");

    // 视图轴与编辑轴正交：源码模式下仍应开关生效（不得被静默忽略）
    await expect(page.locator(".cm-md-focus-mode"), "源码模式应仍带 focus 根标记").toHaveCount(1);
    expect(
      await page.locator(".cm-md-focus-dim").count(),
      "源码模式下仍应有 dim 行装饰",
    ).toBeGreaterThan(0);

    // 打字机半（评审 M-3）：源码模式下也必须真的居中（不得被静默忽略）
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 30"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);
  });

  test("E30/AC-S6-c：静置后不得自激滚动（无无限居中循环，与 W5 同源）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 20"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // 等缓动与 rAF 全部落定后：连续两次采样 scrollTop 必须一致（不得自激）
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    await page.waitForTimeout(600);
    const second = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    expect(second, "静置后不得继续自激滚动").toBe(first);
  });

  test("E15/W3：输入路径即时跟随（禁 smooth —— 大输入后短窗内光标即居中）", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await runCommand(page, "Typewriter Mode");
    await setCaret(page, FOCUS_DOC.lastIndexOf("滚动段落 30"));
    await expect.poll(() => cursorCenterDelta(page), { timeout: 3000 }).toBeLessThan(0.18);

    // 单次大输入：光标瞬间远离中心 → 输入路径必须**即时**完成校正（AC W3）。
    // ⚠️ 窗口必须**短于**动画时长（CENTER_ANIMATION_MS = 140）：否则「改成平滑」的实现
    // 也能在窗口内完成而让本用例失去证伪力（评审 M-1）。
    await page.keyboard.insertText("触发输入期即时校正的长文本内容".repeat(60));
    // 短窗轮询（窗口 < CENTER_ANIMATION_MS=140ms）：即时写只需 1 帧，动画完成需 ~140ms。
    // 证伪力边界（如实声明）：CI/CDP 往返存在抖动，极窄窗口会产生假红，故取 120ms；
    // 这仍能拦住「输入也走完整动画」的回归，但不能稳定区分 0ms 与 140ms 的细微差异。
    await expect
      .poll(() => cursorCenterDelta(page), { timeout: 120, intervals: [16, 16, 32] })
      .toBeLessThan(0.15);
  });

  test("E20/所有权契约：开启专注后移动光标，非活动块仍保持 dim（HIGH-1 回归锁）", async ({
    page,
  }) => {
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    await runCommand(page, "Focus Mode");

    const heading = page.locator(".cm-md-focus-dim").filter({ hasText: "标题块" }).first();
    await expect(heading, "开启后非活动标题块应被 dim").toHaveCount(1);

    // 关键步骤：移动光标 = 仅 selection 变化的一次更新（ViewPlugin.apply() 会重跑）。
    // 修复前该分支对**普通行**也 remove() 装饰集写下的 cm-md-focus-dim/active，
    // 而 CM 的 tile attrs 不会重放 → 非活动块整片静默失去压暗（HIGH-1）。
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".cm-md-focus-active"), "活动块应迁移到段落乙").toContainText(
      "段落乙",
    );

    await expect(heading, "HIGH-1：光标移动后非活动块不得丢失 dim 类").toHaveCount(1);
    await expect
      .poll(() => heading.evaluate((el) => Number(getComputedStyle(el).opacity)), {
        timeout: 2000,
        intervals: [60, 60, 60, 60],
      })
      .toBeLessThanOrEqual(0.5);
  });

  test("E21/F5：整块 widget（setext/引用定义/脚注定义/表格）不消失且无幻影行", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, WIDGET_DOC);
    await setCaret(page, WIDGET_DOC.indexOf("普通段落"));

    const before = await blockStructure(page);
    expect(
      before.widgets,
      "基线：至少 4 个整块 widget（setext 标题 / 引用定义 / 脚注定义 / 表格）",
    ).toBeGreaterThanOrEqual(4);

    // 基线幻影行检查：`.cm-line` 数不得**超过**源文档行数。
    // 同位置 line 装饰与块 widget 共存会经 addLineStartIfNotCovered 插入额外行，
    // 使渲染行数超过源行数 —— 该断言因此能看见「before/after 对比看不见」的基线幻影行
    //（若两个快照都带着同一条幻影行，对比会认为无变化）。
    // 注：此处用 split("\n") 的计数，比 CM 的 doc.lines 多出末尾换行的余量，属**宽松界**，
    // 但足以拦截每个块 widget 各多一行的量级（实测旧行为为 +4 行）。
    const sourceLines = (await readDoc(page)).split("\n").length;
    expect(
      before.lines,
      `基线不得有幻影行（渲染 ${before.lines} 行 ≤ 源 ${sourceLines} 行）`,
    ).toBeLessThanOrEqual(sourceLines);

    await runCommand(page, "Focus Mode");
    await expect(page.locator(".cm-md-focus-mode")).toHaveCount(1);

    // 不变量：开启专注模式**不得**改变块级 DOM 结构 —— 既不多出行（幻影行），也不丢 widget。
    // 该断言直接否定「同位置线装饰 + block widget 共存」导致的 addLineStartIfNotCovered 现象。
    const after = await blockStructure(page);
    expect(after, "F5：专注模式不得改变块级 DOM 结构").toEqual(before);

    // 整块 widget 仍可见，且根元素承载 focus 类（dim 由 widget 根类承担）
    await expect(page.locator(".cm-md-table-widget")).toBeVisible();
    const blockAtoms = page.locator(".cm-md-default-atom--block");
    expect(
      await blockAtoms.count(),
      "setext 标题 / 引用定义 / 脚注定义 = 3 个 block 形态 default atom",
    ).toBeGreaterThanOrEqual(3);
    for (const widget of await blockAtoms.all()) {
      await expect(widget).toHaveClass(/cm-md-focus-(active|dim)/);
    }
  });

  test("E25/AC-S4：光标从标题移入下方表格后，活动块必须迁移（不得残留标题高亮）", async ({
    page,
  }) => {
    await openApp(page);
    await loadDoc(page, STALE_DOC);
    await setCaret(page, STALE_DOC.indexOf("标题"));
    await runCommand(page, "Focus Mode");

    const heading = page.locator(".cm-line").filter({ hasText: "标题" }).first();
    await expect(heading, "基线：光标在标题上时标题应为活动块").toHaveClass(/cm-md-focus-active/);

    // 真实用户操作：点进表格单元格（单元格是 widget 内的 contenteditable）
    await page.locator(".cm-md-table-widget td, .cm-md-table-widget th").first().click();

    // 活动块必须迁移：标题不得再持有 active
    await expect(heading, "S4：活动块不得残留（标题不得仍为 active）").not.toHaveClass(
      /cm-md-focus-active/,
    );
  });

  test("E26/AC-S4b：专注 + 打字机叠加时活动块同样必须迁移", async ({ page }) => {
    await openApp(page);
    await loadDoc(page, STALE_DOC);
    await setCaret(page, STALE_DOC.indexOf("标题"));
    await runCommand(page, "Focus Mode");
    await runCommand(page, "Typewriter Mode");

    const heading = page.locator(".cm-line").filter({ hasText: "标题" }).first();
    await expect(heading, "基线：标题为活动块").toHaveClass(/cm-md-focus-active/);

    await page.locator(".cm-md-table-widget td, .cm-md-table-widget th").first().click();

    await expect(heading, "叠加模式下活动块也不得残留").not.toHaveClass(/cm-md-focus-active/);
  });

  test("E31/AC-S7：快速滚轮滚动不得把视口弹回顶部（默认 / 专注 / 打字机 三态）", async ({
    page,
  }) => {
    await openApp(page);
    await loadDoc(page, SCROLL_DOC);

    const scroller = page.locator(".cm-scroller");
    const fastScroll = async (): Promise<number> => {
      await scroller.hover();
      for (let index = 0; index < 12; index += 1) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(20); // 快速连续滚动
      }
      await page.waitForTimeout(400); // 让“若存在拉回机制”有机会显现
      return page.evaluate(() => document.querySelector(".cm-scroller")!.scrollTop);
    };

    // ① 默认态（无视图模式）
    expect(await fastScroll(), "默认态：快速滚动不得回到顶部").toBeGreaterThan(200);

    // ② 专注模式
    await runCommand(page, "Focus Mode");
    await page.evaluate(() => {
      document.querySelector(".cm-scroller")!.scrollTop = 0;
    });
    expect(await fastScroll(), "专注模式：快速滚动不得回到顶部").toBeGreaterThan(200);

    // ③ 打字机模式（属主 #3 的会话很可能开着它）
    await runCommand(page, "Typewriter Mode");
    await page.evaluate(() => {
      document.querySelector(".cm-scroller")!.scrollTop = 0;
    });
    expect(await fastScroll(), "打字机模式：快速滚动不得回到顶部").toBeGreaterThan(200);
  });

  test("E36/AC-S1-b：文档边界后专注仍生效，且菜单镜像与 DOM 真实状态一致", async ({ page }) => {
    // 审计 ④「S1(b) 未证明（镜像只写不读；文档边界后可能分歧）」的直接反证：
    // ① 真实状态（DOM 根 class）在文档边界后必须仍然成立（视图轴与文档轴正交）；
    // ② 宿主镜像必须与真实状态一致（旧行为：真实状态归 false 而镜像停在 true ⇒ 发散）。
    await openApp(page);
    await loadDoc(page, FOCUS_DOC);
    await setCaret(page, FOCUS_DOC.indexOf("段落甲"));
    await runCommand(page, "Focus Mode");
    await expect(page.locator(".cm-md-focus-mode"), "前置：专注已生效").toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getModeMenuChecks?.().focus ?? null),
      )
      .toBe(true);

    // 文档边界：换成另一篇文档（声明为 different，即“真·换文档”）
    const OTHER_DOC = "# 另一篇文档\n\n正文段落。\n";
    await loadDoc(page, OTHER_DOC, "different");
    await setCaret(page, OTHER_DOC.indexOf("正文段落"));

    await expect(page.locator(".cm-md-focus-mode"), "换文档后专注仍生效（真实状态）").toHaveCount(
      1,
    );
    await expect(page.locator(".cm-md-focus-active"), "活动块按真实状态重算").toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getModeMenuChecks?.().focus ?? null),
      )
      .toBe(true);
  });

  test("E37/AC-S6-b：打字机「移动光标平滑归位」是缓动动画而非瞬时跳变（逐帧采样）", async ({
    page,
  }) => {
    // 审计 ①「AC-S6-b 只有结构级动画锁」的行为级证据。
    //
    // 关键设计（探针实测后定下）：**光标移动必须落在当前视野内**。
    // 若做大幅跳转，CodeMirror 自己会先把光标「滚入视野」（一次瞬时跳变，实测 1169px），
    // 打字机缓动只负责其后的尾段 —— 那种序列无法区分「缓动」与「跳变」。
    // 视野内移动时，滚动完全由打字机居中驱动，于是整条采样序列就是缓动曲线。
    //
    // 采样用 `scroll` 事件（动画每帧写 scrollTop 都触发一次），而非 rAF 循环：
    // rAF 循环的首帧可能被光标移动的同步工作推迟到动画中段，把已完成的部分误计为单帧位移。
    //
    // 探针实测（同一夹具，视野内下移 10 行）：series=[588,635,676,711,742,768,791,809,824,836,…]
    // ⇒ distinct=22 · span=276 · maxStep=47（仅占 17%）—— 衰减型缓动特征，阈值留 ~3 倍余量。
    //
    // 红向对照（**同一夹具、同一 276px 位移，唯一差别是关闭打字机模式**）：
    // series=[260,536] ⇒ distinct=2（瞬时跳变）⇒ 本用例的 distinct ≥ 6 会失败。
    // 即：无缓动则无中间帧，该断言真正区分了「缓动」与「一步到位」。

    await openApp(page);
    await loadDoc(page, TYPEWRITER_ANIMATION_DOC);
    await runCommand(page, "Typewriter Mode");

    // 先定位到文档中段，让 CM 的可见性滚动与打字机居中都已稳定
    await setCaret(page, lineOffsetOf(TYPEWRITER_ANIMATION_DOC, 30));
    await page.waitForTimeout(600);

    await page.evaluate(
      (at) => {
        const scroller = document.querySelector(".cm-scroller")!;
        const holder = window as unknown as {
          __scrollSamples: number[];
          __stopScrollProbe?: () => void;
        };
        holder.__scrollSamples = [Math.round(scroller.scrollTop)];
        const onScroll = () => {
          holder.__scrollSamples.push(Math.round(scroller.scrollTop));
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        holder.__stopScrollProbe = () => scroller.removeEventListener("scroll", onScroll);
        // 与采样同一次 evaluate 内触发光标移动（不隔 CDP 往返）
        window.__MD_EDITOR_E2E__!.setSelection(at, at);
      },
      lineOffsetOf(TYPEWRITER_ANIMATION_DOC, 40), // 视野内下移 10 行 ⇒ 滚动只由打字机居中驱动
    );

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __scrollSamples: number[] }).__scrollSamples.length,
        ),
      )
      .toBeGreaterThan(5);
    await page.waitForTimeout(400);
    await page.evaluate(() =>
      (window as unknown as { __stopScrollProbe?: () => void }).__stopScrollProbe?.(),
    );

    const samples = await page.evaluate(
      () => (window as unknown as { __scrollSamples: number[] }).__scrollSamples,
    );
    const distinct = new Set(samples).size;
    const span = Math.max(...samples) - Math.min(...samples);
    const maxStep = samples.reduce(
      (max, value, index) =>
        index === 0 ? max : Math.max(max, Math.abs(value - samples[index - 1])),
      0,
    );

    expect(span, "前置：确实发生了滚动（否则动画无从谈起）").toBeGreaterThan(150);
    // **帧率无关**的「仍在途中」判据（CI 教训：按「不同数值个数」断言会随 CI 帧率抖动 ——
    // 本仓 CI 曾因 E38 的 distinct ≥ 15 失败，而本机同用例稳过 —— 故改用「首帧是否已就位」：
    // 平滑缓动在动画结束前不可能已达终值；瞬时跳变则首帧就是终值。
    const settledScrollTop = samples[samples.length - 1];
    const inFlight = Math.abs(samples[1] - settledScrollTop);
    expect(
      inFlight,
      `动画途中不得已到达目标（首帧 ${samples[1]} vs 终值 ${settledScrollTop}）`,
    ).toBeGreaterThan(span * 0.05);

    // ---- 对照阶段（code-reviewer 复审 LOW-4：红向对照必须在用例内断言，不能只写在注释里）----
    // 关闭打字机后做**同一次**视野内移动：无缓动 ⇒ 不应出现多个中间帧。
    // 探针实测：关模式同位移 ⇒ series=[260,536]（distinct=2）⇒ 下面 distinct ≤ 3 成立，
    // 而开模式实测 distinct=22 ⇒ 两侧分得开，本用例不是「能滚就绿」。
    await runCommand(page, "Typewriter Mode"); // 再切一次 = 关闭
    await setCaret(page, lineOffsetOf(TYPEWRITER_ANIMATION_DOC, 30));
    await page.waitForTimeout(500);
    await page.evaluate(
      (at) => {
        const scroller = document.querySelector(".cm-scroller")!;
        const holder = window as unknown as { __controlSamples: number[] };
        holder.__controlSamples = [Math.round(scroller.scrollTop)];
        scroller.addEventListener(
          "scroll",
          () => holder.__controlSamples.push(Math.round(scroller.scrollTop)),
          { passive: true },
        );
        window.__MD_EDITOR_E2E__!.setSelection(at, at);
      },
      lineOffsetOf(TYPEWRITER_ANIMATION_DOC, 40),
    );
    await page.waitForTimeout(600);
    const controlSamples = await page.evaluate(
      () => (window as unknown as { __controlSamples: number[] }).__controlSamples,
    );
    const controlDistinct = new Set(controlSamples).size;
    console.log(
      `[E37] on: distinct=${distinct} span=${span} maxStep=${maxStep} inFlight=${inFlight} | off: distinct=${controlDistinct}`,
    );
    expect(
      controlDistinct,
      `关闭打字机后同一次移动不得出现缓动中间帧（实测 ${controlDistinct} 个不同值）`,
    ).toBeLessThanOrEqual(3);
  });

  test("E38/W1：连续快速移动光标不得抖动（运行时观测：单调收敛、无来回）", async ({ page }) => {
    // 审计早前报告点名：W1「抖动」此前只有**常量区间断言**（`CENTER_EPSILON_PX ≤ 2`），
    // 不是**运行时**观测。本用例用与 E37 同款逐帧采样，但改为**连续快速移动光标**
    //（间隔 30ms，远小于 140ms 动画时长 ⇒ 动画被不断重定向，最容易暴露竞争/抖动），
    // 断言：① 运动连续（多个不同中间帧）；② **无方向反转**（来回抖动会被逐帧计数）；③ 最终收敛。
    //
    // 探针实测（5 次快速移动，均在视野内）：
    // series=[588,597,605,612,626,639,658,675,690,709,727,749,770,788,803,813,825,834,838,…]
    // ⇒ distinct=31 · span=276 · **reversals=0** · tail=[859,…,864]（单调收敛）。
    // 对照（唯一差别关闭打字机）：series=[260,315,370,425,480,536] ⇒ 每次移动一步到位。
    // 本用例断言的是**帧率无关**的不变量（方向反转数 + 收敛 + 跨度），不按帧数断言 ——
    // 见下方说明（CI 曾因帧数断言失败）。
    await openApp(page);
    await loadDoc(page, TYPEWRITER_ANIMATION_DOC);
    await runCommand(page, "Typewriter Mode");

    await setCaret(page, lineOffsetOf(TYPEWRITER_ANIMATION_DOC, 30));
    await page.waitForTimeout(600);

    const rapidTargets = [32, 34, 36, 38, 40].map((lineNo) =>
      lineOffsetOf(TYPEWRITER_ANIMATION_DOC, lineNo),
    );
    await page.evaluate((targets) => {
      const scroller = document.querySelector(".cm-scroller")!;
      const holder = window as unknown as { __jitterSamples: number[] };
      holder.__jitterSamples = [Math.round(scroller.scrollTop)];
      scroller.addEventListener(
        "scroll",
        () => holder.__jitterSamples.push(Math.round(scroller.scrollTop)),
        { passive: true },
      );
      // 连续快速移动：间隔 30ms < 动画时长 140ms ⇒ 动画被重定向（竞争/抖动最易在此暴露）
      targets.forEach((at, index) => {
        setTimeout(() => window.__MD_EDITOR_E2E__!.setSelection(at, at), index * 30);
      });
    }, rapidTargets);

    await page.waitForTimeout(900);
    const samples = await page.evaluate(
      () => (window as unknown as { __jitterSamples: number[] }).__jitterSamples,
    );

    const distinct = new Set(samples).size;
    const span = Math.max(...samples) - Math.min(...samples);
    let reversals = 0;
    for (let i = 2; i < samples.length; i += 1) {
      const previousStep = samples[i - 1] - samples[i - 2];
      const currentStep = samples[i] - samples[i - 1];
      if (
        previousStep !== 0 &&
        currentStep !== 0 &&
        Math.sign(previousStep) !== Math.sign(currentStep)
      ) {
        reversals += 1;
      }
    }
    const tail = samples.slice(-5);
    const tailSpan = Math.max(...tail) - Math.min(...tail);
    // 诊断输出（CI 失败时可直接看到度量，便于判定是否真回归）
    console.log(
      `[E38] distinct=${distinct} span=${span} reversals=${reversals} tailSpan=${tailSpan}`,
    );

    // 判别力说明（**CI 教训后改写**）：本用例的职责是**抖动锁**（reversals + 收敛），
    // 而「缓动 vs 一步到位」由 E37 用**帧率无关**的「首帧是否已就位」判据 + 用例内对照覆盖。
    // 早期版本在此断言 `distinct ≥ 15`（本机稳过 27~31），但本仓 CI 帧率明显更低而失败 ——
    // 按「不同数值个数」断言本质上依赖帧率，属于不稳定的判定，已移除。
    expect(span, "前置：连续移动确实产生了滚动").toBeGreaterThan(100);
    expect(
      reversals,
      `连续快速移动过程中不得出现方向反转（抖动/竞争动画）—— 实测 ${reversals} 次`,
    ).toBe(0);
    expect(
      tailSpan,
      `最终必须收敛（尾段位移相对总量可忽略）—— 实测尾段跨 ${tailSpan}px / 总 ${span}px`,
    ).toBeLessThan(span * 0.05);
  });
});
