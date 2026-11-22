/**
 * PRD P2 门禁：删除 6 处静态 `:root` writer 后，**非默认字号面**必须有断言锁住。
 *
 * 为什么这条重要：`--theme-editor-font-size` 现在是编辑器唯一 writer，
 * 一旦某个 app 不再传 `theme.typography.fontSize`，它会静默落回 `inherit`，
 * 表现为"字号跟着页面走"而不是"跟着设置走" —— 用户看不出报错，只觉得"设置没生效"。
 *
 * 覆盖两个非默认面：
 * - `utools`：15px（默认值，且是除 desktop 外唯一的非默认值）；
 * - `mobile`：**不传** theme，靠 `inherit` 落回页面字号（无可见变化，但要锁住这个意图）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("utools 字号面：15px 来自设置，经 theme.typography.fontSize 透传", () => {
  it("默认设置值是 15", () => {
    const source = read("../../../apps/utools/src/utools/db-storage.ts");
    expect(source).toMatch(/fontSize:\s*15\b/u);
  });

  it("UtoolsApp 把 settings.fontSize 放进 theme.typography（不是独立 prop）", () => {
    const source = read("../../../apps/utools/src/components/UtoolsApp.tsx");
    expect(source).toContain("fontSize: settings.fontSize");
    expect(source).toMatch(/theme=\{\{\s*typography:\s*\{/u);
    // 排版 prop 已删除：出现独立 fontSize= 就说明有回归。
    expect(source).not.toMatch(/\n\s+fontSize=\{settings\.fontSize\}/u);
  });
});

describe("mobile 字号面：不传 theme，靠 inherit 落回页面字号", () => {
  it("EditorCanvas 不传任何 theme / 排版 props（inherit 是刻意选择）", () => {
    const source = read("../../../apps/mobile/core/src/components/EditorCanvas.tsx");
    expect(source).not.toMatch(/\btheme=/u);
    expect(source).not.toMatch(/\bfontSize=/u);
  });
});

describe("没有任何 app 的静态样式再声明 --theme-editor-font-size", () => {
  it("五个历史 writer 均已清除", () => {
    const files = [
      "../../../apps/desktop/src/styles.css",
      "../../../apps/web/src/styles.css",
      "../../../apps/utools/src/styles.css",
      "../../../apps/mobile/core/src/styles.css",
      "../../../packages/app-ui/src/themes/kami-themes.ts",
    ];
    for (const file of files) {
      expect(read(file), `${file} 仍在声明该变量`).not.toContain("--theme-editor-font-size");
    }
  });
});
