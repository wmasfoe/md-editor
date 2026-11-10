/**
 * @file style-ownership.test.ts
 * @description 样式归属的反向断言：renderer 归属的规则不得回流到 editor-ui。
 *
 * 背景见 `src/styles/index.ts` 的文件头。核心不变量：
 * 1. `editor-ui` 的 `CodeMirrorEditor.css` 只保留宿主容器布局，不得再出现任何
 *    CodeMirror 内部 DOM 或 renderer 产出类的选择器（`.cm-*`、`.cm-md-*`、`.cm-liquid-*`）；
 * 2. renderer 自持样式**不得依赖宿主类**（`.code-mirror-editor-host`），
 *    否则非 React 宿主依旧拿不到样式；
 * 3. `--theme-*` 变量契约与 CSS 实现保持一致（无未登记变量、无死条目）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EDITOR_STYLE_CSS } from "../../src/styles/index.ts";
import { THEME_VARIABLES } from "../../src/styles/theme-variables.ts";

/** 计算选择器的 (b, c) 特异性分量（a=id 在断言里不需要）。 */
function specOf(selector: string): { b: number; c: number } {
  const withoutPseudo = selector.replace(/::?[\w-]+(?:\([^)]*\))?/gu, "");
  const classes = (withoutPseudo.match(/\.[\w-]+/gu) ?? []).length;
  const attrs = (withoutPseudo.match(/\[[^\]]*\]/gu) ?? []).length;
  const elements = (withoutPseudo.match(/(?:^|[\s>+~])([a-z][\w-]*)/gu) ?? []).length;
  return { b: classes + attrs, c: elements };
}

const EDITOR_UI_CSS = new URL(
  "../../../editor-ui/src/components/CodeMirrorEditor/CodeMirrorEditor.css",
  import.meta.url,
);

/** 提取顶层规则块的选择器（`{` 之前的部分，去注释）。 */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of css) {
    if (char === "{") {
      if (depth === 0) out.push(buffer);
      depth += 1;
      buffer = "";
      continue;
    }
    if (char === "}") {
      depth -= 1;
      buffer = "";
      continue;
    }
    if (depth === 0) buffer += char;
  }
  return out.map((s) => s.replace(/\/\*[\s\S]*?\*\//gu, "").trim()).filter(Boolean);
}

describe("样式归属（反向断言）", () => {
  it("editor-ui 的 CodeMirrorEditor.css 不得包含 renderer 归属选择器", () => {
    const css = readFileSync(EDITOR_UI_CSS, "utf8");
    const offenders = topLevelSelectors(css).filter((selector) =>
      /\.cm-(?:md-|liquid-)?[a-z]/u.test(selector),
    );
    expect(offenders).toEqual([]);
  });

  it("editor-ui 的 CodeMirrorEditor.css 只保留宿主容器布局", () => {
    const css = readFileSync(EDITOR_UI_CSS, "utf8");
    const selectors = topLevelSelectors(css);
    // 只允许宿主自己的容器类（可带 .dark / :root 等宿主侧前缀）。
    for (const selector of selectors) {
      expect(selector).toContain(".code-mirror-editor-host");
    }
  });

  it("renderer 自持样式不得依赖宿主类 .code-mirror-editor-host", () => {
    expect(EDITOR_STYLE_CSS).not.toContain("code-mirror-editor-host");
  });

  it("renderer 自持样式使用自产的 scope 类", () => {
    // scope 由 mode.ts 的 editorAttributes 产出，样式据此限定作用域。
    expect(EDITOR_STYLE_CSS).toContain(".cm-md-editor");
  });
});

describe("--theme-* 变量契约一致性", () => {
  const declared = new Set(THEME_VARIABLES.map((v) => v.name));
  const used = new Set(
    [...EDITOR_STYLE_CSS.matchAll(/var\(\s*(--theme-[a-z0-9-]+)/gu)].map((m) => m[1]),
  );

  it("CSS 中使用的每个变量都已登记在契约里", () => {
    const undeclared = [...used].filter((name) => !declared.has(name));
    expect(undeclared).toEqual([]);
  });

  it("契约里登记的每个变量都在 CSS 中实际使用（无死条目）", () => {
    const unused = [...declared].filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });

  it("每个变量引用都带 fallback（宿主不提供变量也能渲染）", () => {
    const refs = [...EDITOR_STYLE_CSS.matchAll(/var\(\s*(--theme-[a-z0-9-]+)\s*([,)])/gu)];
    const withoutFallback = refs.filter((m) => m[2] === ")").map((m) => m[1]);
    expect(withoutFallback).toEqual([]);
  });
});

describe("样式注入位置：作者样式可以覆盖渲染器", () => {
  it("插在已有 style/link 之前，后出现的自定义规则在同特异性下胜出", async () => {
    const { EDITOR_STYLE_ELEMENT_ID, injectEditorStyles } =
      await import("../../src/styles/index.ts");

    interface FakeNode {
      tagName: string;
      id: string;
      textContent: string | null;
      setAttribute(name: string, value: string): void;
    }
    const children: FakeNode[] = [];
    const make = (tagName: string, id = ""): FakeNode => ({
      tagName,
      id,
      textContent: null,
      setAttribute(name: string, value: string) {
        if (name === "id") this.id = value;
      },
    });
    children.push(make("META"), make("LINK", "app-css"), make("STYLE", "md-editor-custom-theme"));

    const head = {
      children,
      append(node: FakeNode) {
        children.push(node);
      },
      insertBefore(node: FakeNode, anchor: FakeNode) {
        const index = children.indexOf(anchor);
        children.splice(index < 0 ? children.length : index, 0, node);
      },
    };
    const doc = {
      createElement: (tag: string) => make(tag),
      head,
      getElementById: (id: string) => children.find((node) => node.id === id) ?? null,
    };

    injectEditorStyles({ document: doc as unknown as Document });

    expect(children.map((node) => node.id)).toEqual([
      "",
      EDITOR_STYLE_ELEMENT_ID,
      "app-css",
      "md-editor-custom-theme",
    ]);
  });

  it("选区背景不使用 !important，宿主的 !important 可以覆盖", () => {
    const unfocused = EDITOR_STYLE_CSS.match(
      /\.cm-md-editor\.cm-editor \.cm-selectionBackground,/u,
    );
    const focused = EDITOR_STYLE_CSS.match(
      /\.cm-md-editor\.cm-editor\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground \{[^}]*\}/u,
    );
    expect(unfocused).not.toBeNull();
    expect(focused?.[0]).not.toMatch(/!important/u);
    // 聚焦规则必须高于 CM6 的 (0,5,0)，否则去掉 !important 后会被 baseTheme 盖住。
    expect(specOf(focused?.[0]?.split("{")[0] ?? "").b).toBeGreaterThanOrEqual(6);
  });
});

describe("样式注入幂等性", () => {
  it("重复调用只产生一个 style 元素", async () => {
    const { ensureStyleElement } = await import("../../src/styles/create-style-tag.ts");
    interface FakeStyle {
      textContent: string | null;
      attrs: Map<string, string>;
      setAttribute(name: string, value: string): void;
    }
    const created: FakeStyle[] = [];
    let existing: FakeStyle | null = null;

    const port = {
      getElementById: () => existing,
      createStyleElement: () => {
        const element: FakeStyle = {
          textContent: null,
          attrs: new Map<string, string>(),
          setAttribute(name: string, value: string) {
            this.attrs.set(name, value);
          },
        };
        created.push(element);
        existing = element;
        return element;
      },
      appendToHead: () => {},
    };

    ensureStyleElement({ id: "test-style", css: "a{}", port });
    ensureStyleElement({ id: "test-style", css: "a{}", port });
    ensureStyleElement({ id: "test-style", css: "b{}", port });

    expect(created).toHaveLength(1);
    expect(created[0]?.textContent).toBe("b{}");
  });

  it("透传 nonce（CSP 场景）", async () => {
    const { ensureStyleElement } = await import("../../src/styles/create-style-tag.ts");
    const attrs = new Map<string, string>();
    const element = {
      textContent: null as string | null,
      setAttribute: (name: string, value: string) => attrs.set(name, value),
    };
    const port = {
      getElementById: () => null,
      createStyleElement: () => element,
      appendToHead: () => {},
    };

    ensureStyleElement({ id: "n", css: "a{}", nonce: "abc123", port });
    expect(attrs.get("nonce")).toBe("abc123");
  });
});

describe("迁移后的 CSS 完整性（防止文本替换损坏）", () => {
  /**
   * 历史事故：批量加 scope 前缀时，脚本把多行声明值（如 `transition:` 的续行、
   * `box-shadow:` 的阴影列表）误当作选择器，注入了 `.cm-md-editor`，导致
   * 23 条声明被浏览器丢弃、10 个选择器永不匹配。本组断言锁死该形态。
   */

  it("声明值内不得出现 scope 类（会令整条声明失效）", () => {
    const offenders = [...EDITOR_STYLE_CSS.matchAll(/:[^;{}]*\.cm-md-editor[^;{}]*;/gu)].map((m) =>
      m[0].trim().slice(0, 80),
    );
    expect(offenders).toEqual([]);
  });

  it("选择器不得重复 scope（会要求嵌套编辑器，永不匹配）", () => {
    const offenders = [...EDITOR_STYLE_CSS.matchAll(/\.cm-md-editor\s+\.cm-md-editor--/gu)];
    expect(offenders).toEqual([]);
  });

  it("每个 CSS 规则块都带 scope 前缀（媒体查询内部同样要求）", () => {
    const withoutScope: string[] = [];
    const lines = EDITOR_STYLE_CSS.split("\n");
    let inKeyframes = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("@keyframes")) inKeyframes = true;
      if (inKeyframes) {
        if (trimmed === "}") inKeyframes = false;
        continue;
      }
      if (trimmed.startsWith("@")) continue;
      if (!trimmed.endsWith("{") && !trimmed.endsWith(",")) continue;
      const selector = trimmed.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/[ {,]+$/u, "");
      // 裸块（`{` 前无选择器）必须失败：历史上宿主前缀被剥离后曾留下孤儿块，
      // 浏览器整块丢弃，而旧断言因 `!selector → continue` 恰好放过它。
      if (selector === "") {
        withoutScope.push("(裸块：选择器为空)");
        continue;
      }
      if (/^(?:from|to|\d+%)$/u.test(selector)) continue;
      for (const part of selector.split(/,(?![^(]*\))/u)) {
        const piece = part.trim();
        if (!piece) continue;
        // 只校验含 CodeMirror 类的选择器；纯宿主/主题选择器不受此约束。
        if (!/\.cm-/u.test(piece)) continue;
        if (!/\.cm-md-editor(?:--[\w-]+)?/u.test(piece)) withoutScope.push(piece.slice(0, 70));
      }
    }
    expect(withoutScope).toEqual([]);
  });

  it("不得出现无选择器的裸规则块（浏览器会整块丢弃）", () => {
    // 孤儿块形如 `\n{\n  min-height: 0;\n}`：选择器为空，CSS 解析器直接忽略整块。
    expect(EDITOR_STYLE_CSS).not.toMatch(/(?:^|\n)\s*\{/u);
  });

  it("关键视觉规则在迁移后仍然存在（防止整段丢失）", () => {
    // 审计实测出现回归的代表性规则，逐一确认仍在产物中。
    const required = [
      ".cm-md-heading--level-1", // H1 下划线与字号
      ".cm-md-default-atom--reference-definition", // footnote 左边框
      ".cm-md-image-widget__viewer", // hover 才显示的放大按钮
      ".cm-md-table-widget__handle", // 表格行列手柄
      ".cm-panel.cm-panel-lint", // lint 面板
      ".cm-selectionLayer", // 选区层几何（代码块列对齐）
    ];
    const missing = required.filter((selector) => !EDITOR_STYLE_CSS.includes(selector));
    expect(missing).toEqual([]);
  });

  it("多行声明（transition / box-shadow 列表）保持完整", () => {
    // 这些属性的值常写成多行列表；迁移时若把续行当选择器会截断声明。
    const transitions = [...EDITOR_STYLE_CSS.matchAll(/transition:\s*([^;{}]*);/gu)];
    expect(transitions.length).toBeGreaterThan(10);
    for (const match of transitions) {
      expect(match[1]).not.toContain(".cm-md-editor");
    }
  });
});

describe("与 CodeMirror baseTheme 的特异性对抗", () => {
  /**
   * CodeMirror 的 `EditorView.baseTheme` 会把不含 `&` 的选择器编译成
   * `.<baseThemeID> <sel>`，且 baseTheme 在 style 挂载顺序里**最后**（优先级最高）。
   * 因此：
   * - 我们的 `.cls`（0,1,0）输给 `.<id> .cls`（0,2,0）；
   * - 我们的 `.a .b`（0,2,0）输给 `.<id> .cls element`（0,2,1）——元素选择器多一级。
   *
   * 结论：凡目标元素是**元素名**（button/select/input/li/...）且与 baseTheme 有重叠属性时，
   * 我们的选择器必须至少达到 (0,3,0)，即使用复合类（同一元素上的两个类）或额外祖先。
   *
   * 历史事故：`.cm-md-editor--wysiwyg .cm-md-code-toolbar__language`（0,2,0）被
   * `.ͼ1 .cm-md-code-toolbar select`（0,2,1）的 `font: inherit` 压制，
   * 导致语言下拉的 font-size/weight/family 全部回退（12.16px/400/system 字体）。
   */
  it("代码块工具栏内的元素型规则必须高于 baseTheme 的 (0,2,1)", () => {
    // 这些类会被 baseTheme 的 `.cm-md-code-toolbar button/select { font: inherit }` 影响。
    const toolbarSelectors = [
      ...EDITOR_STYLE_CSS.matchAll(/([^{}]*cm-md-code-toolbar__[\w-]+[^{}]*)\{/gu),
    ]
      .map((m) => m[1].trim())
      .filter((sel) => sel && !sel.startsWith("@"));

    expect(toolbarSelectors.length).toBeGreaterThan(0);

    const tooWeak: string[] = [];
    for (const sel of toolbarSelectors) {
      for (const part of sel.split(/,(?![^(]*\))/u)) {
        const piece = part.trim();
        if (!piece) continue;
        const { b, c } = specOf(piece);
        // 要求 b >= 3（如 `.cm-md-editor.cm-md-editor--wysiwyg .cm-md-code-toolbar__x`）
        if (b < 3) tooWeak.push(`${piece} → (0,${b},${c})`);
      }
    }
    expect(tooWeak).toEqual([]);
  });

  it("层级契约：component 规则必须强于 generic 规则（否则会被反超）", () => {
    /**
     * 三层特异性必须严格递增：
     *   CM6 baseTheme  `.<id> .cm-*`        (0,2,0) / `.<id> .cls element` (0,2,1)
     *   generic        `.cm-md-editor.cm-editor .cm-*`              (0,3,0)
     *   component      `.cm-md-editor.cm-editor...--wysiwyg .x`     (0,4,0)+
     *
     * 历史事故（两轮）：
     * 1. generic 只有 (0,2,0) → 被 CM6 baseTheme 压制（padding 4px、monospace）。
     * 2. 把 generic 提到 (0,3,0) 后 component 仍是 (0,2,0) → generic 反超 component
     *    （标题行高 34.848→42.768px、代码行 padding 13.6→0px）。
     * 本断言锁死「component 严格强于 generic」，防止任一侧单独调整破坏层级。
     */
    const generic: string[] = [];
    const component: string[] = [];

    for (const line of EDITOR_STYLE_CSS.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.endsWith("{") && !trimmed.endsWith(",")) continue;
      const sel = trimmed.replace(/[ {,]+$/u, "");
      if (!sel || sel.startsWith("@")) continue;
      for (const part of sel.split(/,(?![^(]*\))/u)) {
        const piece = part.trim();
        if (!piece || !/\.cm-/u.test(piece)) continue;
        if (/\.cm-md-editor--/u.test(piece)) component.push(piece);
        else if (/\.cm-md-editor\.cm-editor(?:![\w-])?/u.test(piece)) generic.push(piece);
      }
    }

    expect(component.length).toBeGreaterThan(0);
    expect(generic.length).toBeGreaterThan(0);

    // 关键：组件元素常常**同时**带 generic 类（如标题行同时是 `.cm-line`），
    // 因此 generic 规则会直接作用在组件元素上。若 component 规则不严格更具体，
    // generic 就会覆盖组件样式（历史事故：标题行高 34.848→42.768px、
    // 代码行 padding 13.6→0px）。
    //
    // 判据：任一 component 选择器的特异性必须 > 任一 generic 选择器的最小值。
    // 用 min(generic) 作阈值：generic 中最强的那条（如选中态叠加）不构成风险，
    // 因为它只作用于叠加态；真正会无差别命中的是最弱的那条基础 generic 规则。
    const minGeneric = Math.min(...generic.map((sel) => specOf(sel).b));
    const violations = component
      .filter((sel) => specOf(sel).b <= minGeneric)
      .map(
        (sel) => `${sel.slice(0, 60)} → component(${specOf(sel).b}) <= generic min(${minGeneric})`,
      );
    expect([...new Set(violations)]).toEqual([]);
  });

  it("generic 规则必须强于 CM6 baseTheme（≥3 个类）", () => {
    const tooWeak: string[] = [];
    for (const line of EDITOR_STYLE_CSS.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.endsWith("{") && !trimmed.endsWith(",")) continue;
      const sel = trimmed.replace(/[ {,]+$/u, "");
      if (!sel || sel.startsWith("@")) continue;
      for (const part of sel.split(/,(?![^(]*\))/u)) {
        const piece = part.trim();
        if (!piece || !/\.cm-md-editor\.cm-editor/u.test(piece)) continue;
        if (/\.cm-md-editor--/u.test(piece)) continue;
        // 根元素自身（`.cm-md-editor.cm-editor`，无后代选择器）不参与此下限：
        // 它只与 CM6 的 `.<id>` 根规则（0,1,0）竞争，两个类已足够。
        if (!/[\s>+~]/.test(piece)) continue;
        if (specOf(piece).b < 3) tooWeak.push(piece.slice(0, 70));
      }
    }
    expect(tooWeak).toEqual([]);
  });
});
