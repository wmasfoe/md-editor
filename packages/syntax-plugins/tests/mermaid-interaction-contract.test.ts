/**
 * Mermaid 交互契约的**源码级**结构断言（AC8「不新增 keymap」/ AC12「tabIndex=-1」的门禁面）。
 *
 * 为什么需要它：这两条契约的行为面在 e2e 里是"负例"（Enter 仍换行、Tab 不停靠），
 * 只能证明"目前没坏"，无法证明"没有新增加绑定点"。这里改成从**源码**枚举：
 * 新增 keymap / 新增可聚焦控件却不设 tabIndex 时立即变红，把约束前移到编写路径。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MERMAID_SRC_DIR = fileURLToPath(new URL("../src/mermaid", import.meta.url));

function readSource(name: string): string {
  return readFileSync(`${MERMAID_SRC_DIR}/${name}`, "utf-8");
}

describe("mermaid 交互契约（源码级）", () => {
  it("不新增任何 keymap（Enter 冗余已由 owner 签字删除：块边界光标本身即激活源码）", () => {
    for (const file of [
      "mermaid-projection.ts",
      "mermaid-parser.ts",
      "mermaid-loader.ts",
      "index.ts",
    ]) {
      const source = readSource(file);
      expect(source, `${file} 不应引入 keymap`).not.toContain("keymap");
      expect(source, `${file} 不应新增 Enter 绑定`).not.toMatch(/key:\s*"Enter"/u);
    }
  });

  it("块体不把指针事件交给 CM6（ignoreEvent 返回 true）", () => {
    const source = readSource("mermaid-projection.ts");
    expect(source).toMatch(/ignoreEvent\([^)]*\)[^{]*\{[^}]*return true;/su);
  });

  it("工具栏按钮逐个声明字面量 tabIndex = -1（护栏为逐文件正则匹配，不能只写 setAttribute）", () => {
    const source = readSource("mermaid-projection.ts");
    expect(source).toContain("tabIndex = -1");
    expect(source).not.toMatch(/setAttribute\(\s*["']tabindex["']/iu);
  });

  it("块体不再通过 mousedown 主动 dispatch 选区（原「单击即进源码」的主因）", () => {
    const source = readSource("mermaid-projection.ts");
    const mousedownBlock = /addEventListener\("mousedown"[\s\S]*?\}\);/u.exec(source)?.[0] ?? "";
    expect(mousedownBlock).not.toBe("");
    expect(mousedownBlock).not.toContain("view.dispatch");
  });
});
