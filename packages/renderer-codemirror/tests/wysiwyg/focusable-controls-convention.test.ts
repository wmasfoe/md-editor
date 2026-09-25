import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 结构护栏（architect WATCH 驱动项）：**文档内可聚焦控件必须 `tabIndex = -1`**。
 *
 * 为什么需要它：E32（E2E）只在**夹具渲染到的** widget 上枚举可 Tab 元素 ⇒
 * 新 widget 若创建可聚焦控件而不处理，E32 会**静默保持绿色**（护栏会腐烂）。
 * 本测试改从**源码**枚举「创建可聚焦元素」的位置，把约束前移到**编写路径**：
 * 新增 widget 若创建 button/select/input 或可编辑元素却未声明 `tabIndex = -1`，立即变红。
 *
 * 白名单 = **有意的可键盘到达控件**（可访问性诉求）；每条都必须写明依据，且由第二个用例
 * 强制依据非空，防止「为过测试而无声扩白名单」。
 */
const WIDGET_SRC = fileURLToPath(new URL("../../src/wysiwyg", import.meta.url));

const INTENTIONAL_A11Y_ALLOWLIST: Record<string, string> = {
  "code-block-toolbar-widget.ts":
    "M2C-A01/A05（codemirror-m2-code-block-accessibility.spec.ts）要求代码块操作可键盘到达",
  "image-widget.ts":
    "图片放大查看/源输入为可达操作（与代码块工具栏同类的可访问性判断；无对应 spec，属判断而非规格）",
  "search-panel.ts": "搜索面板是编辑器**外置** UI，不在 .cm-content 文档内容内",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("文档内可聚焦控件约定（源码级结构护栏）", () => {
  it("创建 button/select/input/textarea 或可编辑元素的文件，必须声明 tabIndex = -1 或在白名单内", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(WIDGET_SRC)) {
      const name = file.split("/").pop() ?? file;
      if (INTENTIONAL_A11Y_ALLOWLIST[name] !== undefined) {
        continue;
      }
      const source = readFileSync(file, "utf-8");
      const createsFocusable =
        /createElement\("(?:button|select|input|textarea)"\)/.test(source) ||
        /contentEditable = "(?:true|plaintext-only)"/.test(source);
      if (!createsFocusable) {
        continue;
      }
      if (!/tabIndex = -1/.test(source)) {
        offenders.push(name);
      }
    }
    expect(
      offenders,
      "新增 widget 创建可聚焦元素时必须 tabIndex=-1（或加入白名单并写明可访问性依据）",
    ).toEqual([]);
  });

  it("白名单必须逐条写明依据（防止无声扩张）", () => {
    for (const [name, reason] of Object.entries(INTENTIONAL_A11Y_ALLOWLIST)) {
      expect(reason.length, `${name} 的白名单依据必须非空且有意义`).toBeGreaterThan(10);
    }
  });
});
