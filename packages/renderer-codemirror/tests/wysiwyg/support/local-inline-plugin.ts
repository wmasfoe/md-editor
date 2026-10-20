/**
 * @file local-inline-plugin.ts
 * @description 测试专用：注册一个**本地**的 `inline-visible-markers` 语法插件。
 *
 * 为什么不直接 import `@md-editor/syntax-plugins` 的 math/highlight：
 * 该包反向依赖 `@md-editor/renderer-codemirror`（见其 package.json），在本包测试里
 * 反向 import 会构成包级循环依赖，而跨包深导入被仓库结构规则禁止。
 *
 * 硬约束（与 test-spec 约定 3 对应）：
 * 1. 必须使用**完整 `nodePolicies`** 形态；`nodePolicy` 简写会硬编码
 *    `markerNodeNames: []` + `contentStrategy: "full"`，导致零 marker ⇒ 白名单用例空转；
 * 2. 标记节点必须是记录节点的**直接子节点**（`collectMarkerRanges` 只查 direct children）；
 * 3. `kind` 必须复用闭集既有字面量（这里用 `highlight`）；
 * 4. **不得**实现 `resolveContentRange`（其优先级高于 `contentStrategy`，会旁路
 *    `between-markers`，可令 contentRange 意外为 null）。
 */
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import type { MarkdownSyntaxKind } from "../../../src/markdown/range-types.ts";
import type { MarkdownNodePolicy } from "../../../src/markdown/node-policy.ts";
import type { MarkdownSyntaxPlugin } from "../../../src/plugins/syntax-plugin.ts";

export const LOCAL_INLINE_NODE = "LocalInline";
export const LOCAL_INLINE_MARK = "LocalInlineMark";
export const LOCAL_INLINE_FENCE = "%%";
export const LOCAL_INLINE_PLUGIN_ID = "test.local-inline";

const PERCENT = 37;

function localInlineExtension(): MarkdownConfig {
  return Object.freeze({
    defineNodes: Object.freeze([
      Object.freeze({ name: LOCAL_INLINE_NODE, block: false }),
      LOCAL_INLINE_MARK,
    ]),
    parseInline: Object.freeze([
      Object.freeze({
        name: LOCAL_INLINE_NODE,
        before: "Link",
        parse(cx: InlineContext, next: number, position: number) {
          if (next !== PERCENT || cx.char(position + 1) !== PERCENT) {
            return -1;
          }
          const inner = cx.slice(position + 2, cx.end) as string;
          const closeOffset = inner.indexOf(LOCAL_INLINE_FENCE);
          if (closeOffset < 0) {
            return -1;
          }
          const contentFrom = position + 2;
          const contentTo = contentFrom + closeOffset;
          const to = contentTo + LOCAL_INLINE_FENCE.length;
          return cx.addElement(
            cx.elt(LOCAL_INLINE_NODE, position, to, [
              cx.elt(LOCAL_INLINE_MARK, position, contentFrom),
              cx.elt(LOCAL_INLINE_MARK, contentTo, to),
            ]),
          );
        },
      }),
    ]),
  }) as MarkdownConfig;
}

export const localInlineMarkdownExtension: MarkdownConfig = localInlineExtension();

const LOCAL_INLINE_POLICY: MarkdownNodePolicy = Object.freeze({
  kind: "highlight" as MarkdownSyntaxKind,
  renderPolicy: "inline-visible-markers" as const,
  editPolicy: "native" as const,
  interactionPolicy: "text" as const,
  priority: 42,
  markerNodeNames: Object.freeze([LOCAL_INLINE_MARK]),
  contentStrategy: "between-markers" as const,
});

export const localInlinePlugin: MarkdownSyntaxPlugin = Object.freeze({
  id: LOCAL_INLINE_PLUGIN_ID,
  name: "Test Local Inline",
  markdownExtension: localInlineMarkdownExtension,
  nodePolicies: Object.freeze({
    [LOCAL_INLINE_NODE]: LOCAL_INLINE_POLICY,
  }),
});

/** 文档模板：一段普通文本 + 一条本地行内记录（kind = highlight，非四类白名单）。 */
export function localInlineMarkdown(content = "lit"): string {
  return `Head\n\nplain ${LOCAL_INLINE_FENCE}${content}${LOCAL_INLINE_FENCE} tail\n`;
}
