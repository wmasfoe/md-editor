/**
 * MDX 冷启动：解析器就绪后必须把 `<Callout>` 从"按 HTML 处理"升级为 MDX 记录。
 *
 * 历史缺陷（PR #292 复审指出）：冷启动时 MDX 解析器不在，`<Callout>` 会落到
 * lang-markdown 的 HTML 节点，记录成 `deferred-html` 且 **`parserCoverage` 是 complete**
 * （语法解析确实没问题，只是没被当成 MDX）。而刷新判据只查
 * `parserCoverage !== "complete"` —— 永远返回 false，组件就永久停在 HTML 处理上。
 *
 * 现有用例（module-loader-multi-view）手工构造了 `parserCoverage: "partial"` 的记录，
 * 恰好绕开了这个触发条件，所以一直是绿的。这里从**冷缓存 + 真实 `<Callout>` 文档**
 * 开始，断言记录类型本身发生翻转。
 */
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";

import { M1_MARKDOWN_EXTENSIONS } from "../src/markdown/extensions.ts";
import { markdownRangeIndexField, mdxModeFacet } from "../src/markdown/range-index.ts";
import { preloadOptionalModules, resetOptionalModuleCache } from "../src/module-loader";
import { refreshOptionalModuleProjection } from "../src/renderer/controller/optional-modules.ts";

afterEach(() => {
  resetOptionalModuleCache();
});

function createState(): EditorState {
  return EditorState.create({
    doc: "<Callout>hello</Callout>\n",
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      mdxModeFacet.of(true),
      markdownRangeIndexField,
    ],
  });
}

const kinds = (state: EditorState) =>
  state.field(markdownRangeIndexField).records.map((record) => record.kind);

describe("MDX 冷启动：被跳过的候选必须可识别", () => {
  it("冷缓存下 <Callout> 被当成 HTML（记录的 coverage 仍是 complete）", () => {
    resetOptionalModuleCache();
    const state = createState();
    const records = state.field(markdownRangeIndexField).records;
    expect(records.length).toBeGreaterThan(0);
    // 关键前提：coverage 是 complete —— 只看它无法判断"MDX 没处理"。
    expect(records.every((record) => record.parserCoverage === "complete")).toBe(true);
    expect(kinds(state)).not.toContain("mdx-jsx");
  });

  it("解析器就绪后，刷新判据必须为真（这正是旧实现漏掉的那一类）", async () => {
    resetOptionalModuleCache();
    let state = createState();
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: { effects: unknown }) {
        const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
        // 重放"重建解析索引"这条 effect：直接重建状态并保留 mdxMode。
        if (effects.length > 0) {
          state = EditorState.create({
            doc: state.doc.toString(),
            extensions: [
              markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
              mdxModeFacet.of(true),
              markdownRangeIndexField,
            ],
          });
          dispatched += 1;
        }
      },
    };
    let dispatched = 0;

    await preloadOptionalModules();
    const refreshed = refreshOptionalModuleProjection(view as never, "mdx-parser");

    expect(refreshed).toBe(true);
    expect(dispatched).toBe(1);
    // 重算后记录从"按 HTML 处理"翻转为 MDX。
    expect(kinds(state)).toContain("mdx-jsx");
  });

  it("没有 MDX 候选的文档不刷新（避免凭空多派事务）", async () => {
    resetOptionalModuleCache();
    const state = EditorState.create({
      doc: "# plain\n\ntext\n",
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        mdxModeFacet.of(true),
        markdownRangeIndexField,
      ],
    });
    let dispatched = 0;
    const view = {
      state,
      dispatch() {
        dispatched += 1;
      },
    };

    await preloadOptionalModules();
    expect(refreshOptionalModuleProjection(view as never, "mdx-parser")).toBe(false);
    expect(dispatched).toBe(0);
  });

  /**
   * 冷启动时 `<Foo ü="test" />` **不产生任何记录** —— lang-markdown 的 HTML
   * 节点规则不认带非 ASCII 属性名的标签。只看记录会漏掉整类输入（实测刷新
   * 返回 false，手动重建同一状态却立刻得到 `mdx-jsx`）。
   * 因此候选必须从源码辨认。
   */
  it('冷启动无任何记录的 <Foo ü="test" /> 也必须触发刷新', async () => {
    resetOptionalModuleCache();
    const probe = EditorState.create({
      doc: '<Foo ü="test" />\n',
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        mdxModeFacet.of(true),
        markdownRangeIndexField,
      ],
    });
    // 前提：冷启动完全没有记录，所以"遍历记录找候选"必然为空。
    expect(kinds(probe)).toEqual([]);

    let state = probe;
    let dispatched = 0;
    const view = {
      get state() {
        return state;
      },
      dispatch() {
        dispatched += 1;
        state = EditorState.create({
          doc: state.doc.toString(),
          extensions: [
            markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
            mdxModeFacet.of(true),
            markdownRangeIndexField,
          ],
        });
      },
    };

    await preloadOptionalModules();
    expect(refreshOptionalModuleProjection(view as never, "mdx-parser")).toBe(true);
    expect(dispatched).toBe(1);
    // 真实刷新事务后，同内容得到 mdx-jsx 记录。
    expect(kinds(state)).toContain("mdx-jsx");
  });

  it("行内代码里的 <Foo 不算候选", async () => {
    resetOptionalModuleCache();
    const state = EditorState.create({
      doc: "text `<Foo />` more\n",
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        mdxModeFacet.of(true),
        markdownRangeIndexField,
      ],
    });
    expect(kinds(state)).toContain("inline-code");
    let dispatched = 0;
    const view = {
      state,
      dispatch() {
        dispatched += 1;
      },
    };

    await preloadOptionalModules();
    expect(refreshOptionalModuleProjection(view as never, "mdx-parser")).toBe(false);
    expect(dispatched).toBe(0);
  });

  it("围栏代码里的 <Foo 不算 MDX 候选（不触发无谓重建）", async () => {
    resetOptionalModuleCache();
    const state = EditorState.create({
      doc: "```\n<Callout />\n```\n",
      extensions: [
        markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
        mdxModeFacet.of(true),
        markdownRangeIndexField,
      ],
    });
    // 前提：围栏内容记录成 deferred-code，而不是 html/deferred-html。
    expect(kinds(state)).toContain("deferred-code");
    let dispatched = 0;
    const view = {
      state,
      dispatch() {
        dispatched += 1;
      },
    };

    await preloadOptionalModules();
    expect(refreshOptionalModuleProjection(view as never, "mdx-parser")).toBe(false);
    expect(dispatched).toBe(0);
  });

  it("非 MDX 模式下大写标签是合法 HTML，不触发刷新", async () => {
    resetOptionalModuleCache();
    const state = EditorState.create({
      doc: "<Callout>hello</Callout>\n",
      extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS }), markdownRangeIndexField],
    });
    let dispatched = 0;
    const view = {
      state,
      dispatch() {
        dispatched += 1;
      },
    };

    await preloadOptionalModules();
    expect(refreshOptionalModuleProjection(view as never, "mdx-parser")).toBe(false);
    expect(dispatched).toBe(0);
  });
});
