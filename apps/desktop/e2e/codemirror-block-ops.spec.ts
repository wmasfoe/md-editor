import { expect, test } from "@playwright/test";
import {
  MOD_KEY,
  openFullApp as openApp,
  loadDoc,
  readDoc,
  runCommand,
  setCaret,
} from "./editor-e2e-helpers";

/**
 * E16–E17：块操作的 desktop Playwright E2E（test-spec §3；O1/O2/O3）。
 *
 *  - E16 / O1+O2：块下移、块复制（全部经 G007 命令面板 → host action → renderer ports）
 *  - E17 / O3   🔴：**受保护块删除全部生效**（标题 / 围栏代码 / 表格 / 引用）——
 *                   这是 H2（受保护事务注解）在真实 app 的端到端证据；
 *                   修复前对 table/fence 类块的删除会被 transaction filter **静默拒绝**
 *                   （调用方不抛错、文档不变），既有单测因未组装 wysiwygChangeProtection
 *                   而结构性不可见（假设 A3）。
 *
 *  - O5（多块选区）按 spec 显式降级（唯一豁免项 C），本文件不覆盖。
 */

test.describe("块操作（真实 desktop app · G007 命令面板路径）", () => {
  test("E16/O1+O2：块下移改变顺序；块复制使内容出现两次", async ({ page }) => {
    await openApp(page);
    const doc = "段落一\n\n段落二\n\n段落三\n";
    await loadDoc(page, doc);
    await setCaret(page, doc.indexOf("段落二") + 1);

    await runCommand(page, "Move Block Down");
    const moved = await readDoc(page);
    expect(moved.indexOf("段落三"), "O1：段落三上移到段落二之前").toBeLessThan(
      moved.indexOf("段落二"),
    );
    expect(moved, "内容守恒").toContain("段落一");

    // 复制当前块（光标仍落在移动后的“段落二”内）
    await setCaret(page, moved.indexOf("段落二") + 1);
    await runCommand(page, "Duplicate Block");
    const duplicated = await readDoc(page);
    expect((duplicated.match(/段落二/g) ?? []).length, "O2：复制一次 → 出现两处").toBe(2);
  });

  test("E17/O3 🔴：标题 / 代码块 / 表格 / 引用的删除全部生效（H2 端到端证据）", async ({
    page,
  }) => {
    await openApp(page);
    const doc = [
      "# 待删标题",
      "",
      "保留段落",
      "",
      "```js",
      "const gone = 1;",
      "```",
      "",
      "| 表 | 格 |",
      "| --- | --- |",
      "| 单 | 元 |",
      "",
      "> 待删引用",
      "",
      "尾段",
      "",
    ].join("\n");
    await loadDoc(page, doc);

    // 1) 标题
    await setCaret(page, doc.indexOf("# 待删标题") + 3);
    await runCommand(page, "Delete Block");
    expect(await readDoc(page), "标题被删除").not.toContain("# 待删标题");

    // 2) 围栏代码块（fence 语法在 protectedRanges 内 → 必须靠 H2 注解过闸）
    const afterHeading = await readDoc(page);
    await setCaret(page, afterHeading.indexOf("const gone") + 3);
    await runCommand(page, "Delete Block");
    expect(await readDoc(page), "代码块被删除").not.toContain("const gone");

    // 3) 表格（table provenance range → 静默拒绝的头号场景）
    const afterCode = await readDoc(page);
    await setCaret(page, afterCode.indexOf("| 单 | 元 |") + 3);
    await runCommand(page, "Delete Block");
    expect(await readDoc(page), "表格被删除").not.toContain("| 表 | 格 |");

    // 4) 引用
    const afterTable = await readDoc(page);
    await setCaret(page, afterTable.indexOf("> 待删引用") + 4);
    await runCommand(page, "Delete Block");
    const final = await readDoc(page);
    expect(final, "引用被删除").not.toContain("> 待删引用");
    expect(final, "相邻块守恒：保留段落").toContain("保留段落");
    expect(final, "相邻块守恒：尾段").toContain("尾段");

    // O5（多块选区）按 spec 显式降级 —— 不在此覆盖（唯一豁免项 C）。
  });

  test("LOW-1：Mod+K 唤起/关闭命令面板不得改动文档（编辑器 Mod-k 已让位于全局面板）", async ({
    page,
  }) => {
    await openApp(page);
    const doc = "面板开合零变更的段落。\n";
    await loadDoc(page, doc);
    await page.keyboard.press(`${MOD_KEY}+k`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await readDoc(page), "回归锁：唤面板曾在光标处插入 [](url)（双发缺陷）").toBe(doc);
  });

  test("E28/AC-S8：块操作快捷键（Mod-Alt+↓ 下移 / Mod-Alt+D 复制 / Mod-Alt+Backspace 删除）", async ({
    page,
  }) => {
    await openApp(page);
    const doc = ["段落甲", "", "段落乙", "", "段落丙", ""].join("\n");
    await loadDoc(page, doc);

    // 下移：段落乙 与 段落丙 交换位置（用顺序断言，不耦合空行归一细节）
    await setCaret(page, doc.indexOf("段落乙"));
    await page.keyboard.press(`${MOD_KEY}+Alt+ArrowDown`);
    const moved = await readDoc(page);
    expect(moved.indexOf("段落丙"), "Mod-Alt+↓ 应触发下移块").toBeLessThan(moved.indexOf("段落乙"));

    // 复制：段落乙 出现两次
    await setCaret(page, moved.indexOf("段落乙"));
    await page.keyboard.press(`${MOD_KEY}+Alt+d`);
    const duplicated = await readDoc(page);
    expect(duplicated.split("段落乙").length - 1, "Mod-Alt+D 应触发复制块").toBe(2);

    // 删除：回到一次
    await setCaret(page, duplicated.indexOf("段落乙"));
    await page.keyboard.press(`${MOD_KEY}+Alt+Backspace`);
    const deleted = await readDoc(page);
    expect(deleted.split("段落乙").length - 1, "Mod-Alt+Backspace 应触发删除块").toBe(1);

    // 上移（评审 L-4：上移键位此前未覆盖）—— 放在最后，避免打乱前面各步的前置顺序
    await setCaret(page, deleted.indexOf("段落丙"));
    await page.keyboard.press(`${MOD_KEY}+Alt+ArrowUp`);
    const movedUp = await readDoc(page);
    expect(movedUp.indexOf("段落丙"), "Mod-Alt+↑ 应触发上移块").toBeLessThan(
      movedUp.indexOf("段落乙"),
    );
  });
});
