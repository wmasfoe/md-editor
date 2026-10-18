import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
 * v7 修订（ralplan 第 5–6 轮评审结论）：
 * - 扫描根由**单根常量**改为 `SCAN_ROOTS` **两个根都扫**。此前只有
 *   `packages/renderer-codemirror/src/wysiwyg`，把常量改指他处即可**静默丢掉二十余文件的覆盖**
 *   而本测试仍全绿；
 * - 白名单键由 basename 改为 `rootId:basename`（防双根同名共享豁免），断言由「条目数不增加」
 *   升级为**集合精确相等**；
 * - 新增两条判别力断言：① 每个根都必须真的扫到已知文件；② 在临时目录放入违规合成文件时
 *   必须被抓到（证明扫描器没有退化成空转）。
 */
interface ScanRoot {
  readonly id: string;
  readonly dir: string;
}

/** 扫描根（**两个都扫**；新增/删除根必须同时更新此常量的断言）。 */
const SCAN_ROOTS: readonly ScanRoot[] = Object.freeze([
  { id: "wysiwyg", dir: fileURLToPath(new URL("../../src/wysiwyg", import.meta.url)) },
  {
    id: "syntax-plugins",
    dir: fileURLToPath(new URL("../../../syntax-plugins/src", import.meta.url)),
  },
  // 媒体查看器自建关闭/编辑按钮，必须在护栏覆盖内（architect R5）
  { id: "media-viewer", dir: fileURLToPath(new URL("../../src/media-viewer", import.meta.url)) },
]);

/** 白名单 = **有意的可键盘到达控件**（可访问性诉求）；每条都必须写明依据。
 *
 * 裁决冲突登记（2026-10，architect R4）：`mermaid` 的工具栏按钮同样位于 `.cm-content` 内、
 * 同样是“查看/编辑源码”类动作，却**有意**取 `tabIndex=-1`（不可 Tab 达）——因为该块在键盘路径上
 * 已有“光标/方向键进入块即展开源码”的等价入口，且 owner 决策（codemirror-m2-code-block-accessibility.spec.ts）
 * 明确“Tab 由编辑器内容消费、焦点必须留在内容区”。图片 widget 的同类控件历史上被本白名单认定为可达，
 * 两者结论相反且长期共存：**新增同类控件时先看本节，不要默认为模板。** */
const INTENTIONAL_A11Y_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  "wysiwyg:code-block-toolbar-widget.ts":
    "M2C-A01/A05（codemirror-m2-code-block-accessibility.spec.ts）要求代码块操作可键盘到达",
  "wysiwyg:image-widget.ts":
    "图片放大查看/源输入为可达操作（与代码块工具栏同类的可访问性判断；无对应 spec，属判断而非规格）",
  "wysiwyg:search-panel.ts": "搜索面板是编辑器**外置** UI，不在 .cm-content 文档内容内",
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

/** 返回某根下被扫描到的相对路径（用于"根是否真的被扫到"的判别力断言）。 */
export function collectScannedRelativePaths(root: ScanRoot): readonly string[] {
  return sourceFiles(root.dir).map((file) => file.slice(root.dir.length + 1));
}

/**
 * 纯函数扫描器：返回违规文件的 `rootId:basename` 列表。
 * 抽成纯函数是为了能在**临时目录**上做反例验证（不必往真实源码树里塞违规文件——
 * 那会直接打挂 `scripts/structure/check.mjs` 的集合精确相等规则）。
 */
export function findOffenders(
  roots: readonly ScanRoot[],
  allowlist: Readonly<Record<string, string>> = INTENTIONAL_A11Y_ALLOWLIST,
): readonly string[] {
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root.dir)) {
      const key = `${root.id}:${file.split("/").pop() ?? file}`;
      if (allowlist[key] !== undefined) {
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
        offenders.push(key);
      }
    }
  }
  return offenders;
}

describe("文档内可聚焦控件约定（源码级结构护栏）", () => {
  it("创建 button/select/input/textarea 或可编辑元素的文件，必须声明 tabIndex = -1 或在白名单内", () => {
    expect(
      findOffenders(SCAN_ROOTS),
      "新增 widget 创建可聚焦元素时必须 tabIndex=-1（或加入白名单并写明可访问性依据）",
    ).toEqual([]);
  });

  it("扫描根集合精确等于三个既定根（防止改指根导致覆盖静默丢失）", () => {
    expect(SCAN_ROOTS.map((root) => root.id)).toEqual([
      "wysiwyg",
      "syntax-plugins",
      "media-viewer",
    ]);
  });

  it("每个扫描根都必须真的扫到已知文件（防止根系退化为空转）", () => {
    expect(collectScannedRelativePaths(SCAN_ROOTS[0]!)).toContain("widgets/image-widget.ts");
    expect(collectScannedRelativePaths(SCAN_ROOTS[1]!)).toContain("mermaid/mermaid-projection.ts");
    expect(collectScannedRelativePaths(SCAN_ROOTS[2]!)).toContain("browser.ts");
  });

  it("判别力：临时目录中的违规合成文件必须被抓到（扫描器不退化为空转）", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "a11y-guard-"));
    try {
      mkdirSync(join(tempRoot, "nested"), { recursive: true });
      writeFileSync(
        join(tempRoot, "nested", "violating-widget.ts"),
        'const button = document.createElement("button");\n',
        "utf-8",
      );
      writeFileSync(
        join(tempRoot, "nested", "compliant-widget.ts"),
        'const button = document.createElement("button");\nbutton.tabIndex = -1;\n',
        "utf-8",
      );
      expect(findOffenders([{ id: "temp", dir: tempRoot }], {})).toEqual([
        "temp:violating-widget.ts",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("白名单必须是精确集合且逐条写明依据（防止无声扩张）", () => {
    expect(Object.keys(INTENTIONAL_A11Y_ALLOWLIST).toSorted()).toEqual([
      "wysiwyg:code-block-toolbar-widget.ts",
      "wysiwyg:image-widget.ts",
      "wysiwyg:search-panel.ts",
    ]);
    for (const [key, reason] of Object.entries(INTENTIONAL_A11Y_ALLOWLIST)) {
      expect(reason.length, `${key} 的白名单依据必须非空且有意义`).toBeGreaterThan(10);
    }
  });
});
