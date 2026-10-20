/**
 * @file inline-marker-reveal.ts
 * @description 四类内置行内标记（bold / italic / strikethrough / inline-code）的**源码显形点集**派生。
 *
 * 为什么需要独立点集：`activeSyntaxIds` 是**全局激活契约**（驱动 atomic ranges、protected ranges、
 * link/text 显形），其范围选区分支使用**严格重叠**（`sourceRangesOverlap`）且在
 * `record.fullRange.from >= to` 处提前 break（见 `overlapping()`）。因此"选区恰好贴住记录
 * 首尾外侧"不会进入 active 集合。属主明确要求"贴边即露"，故这里用 `index.touching()`
 * （闭区间）为**仅四类内置 kind** 派生一个独立点集，且**不回写**全局激活契约。
 *
 * 折叠光标下 `touching(p, p) ≡ overlapping(p, p)`（同属闭区间包含），因此该点集相对
 * active 的**唯一净增量是范围选区贴边**——这也是本文件存在的全部理由。
 *
 * 新鲜度契约：`InlineMarkerRevealIds` 带 unique symbol 品牌，**只有本模块的
 * `resolveInlineMarkerRevealIds` 能产出该类型**；`freezeProjectionState` 的第二参数
 * 使用该类型，使得"把上一状态的旧数组直接传回去"在编译期失败。
 */
import type { EditorSelection } from "@codemirror/state";
import type { MarkdownRangeIndex } from "../../markdown/range-index.ts";
import type { MarkdownSyntaxKind } from "../../markdown/range-types.ts";
import { sortStrings } from "./atoms.ts";

declare const inlineMarkerRevealBrand: unique symbol;

/**
 * 带品牌的显形点集：仅 `resolveInlineMarkerRevealIds` 可产出（见文件头"新鲜度契约"）。
 * 投影状态的对外字段仍声明为普通 `readonly string[]`，消费者无需感知品牌。
 */
export type InlineMarkerRevealIds = readonly string[] & {
  readonly [inlineMarkerRevealBrand]: true;
};

/**
 * 受本开关控制的四类内置行内标记。
 *
 * ⚠️ 白名单是硬约束：`renderPolicy: "inline-visible-markers"` 并非这四类独有——
 * `inline-math`（`$…$`）、`highlight`（`==…==`）以及 registry 简写生成的插件节点
 * 同样使用该策略，但它们属于 Non-goal，必须保持现状。
 */
export const INLINE_SOURCE_MARKER_KINDS: readonly MarkdownSyntaxKind[] = Object.freeze([
  "bold",
  "italic",
  "strikethrough",
  "inline-code",
]);

const INLINE_SOURCE_MARKER_KIND_SET: ReadonlySet<string> = new Set(INLINE_SOURCE_MARKER_KINDS);

/**
 * 判断某个 kind 是否属于受本开关控制的四类内置行内标记。
 *
 * 该判定是**唯一**的白名单来源：投影层派生点集与装饰构造器都走这里，
 * 避免两处各建一份 Set 后出现"一处改了、另一处忘了"的漂移。
 */
export function isInlineSourceMarkerKind(kind: string): boolean {
  return INLINE_SOURCE_MARKER_KIND_SET.has(kind);
}

/** 品牌化辅助：唯一的品牌出口（cast 集中在此处，便于审计）。 */
function asRevealIds(ids: readonly string[]): InlineMarkerRevealIds {
  return ids as InlineMarkerRevealIds;
}

/**
 * 空点集常数（同一引用）。
 *
 * 直接动机有两个：
 * 1. 开关 ON 时 marker 恒显，显形点集不参与渲染 ⇒ 返回常数可让"仅贴边变化"的选区事务
 *    不产出新投影对象，避免 ON 模式比改造前更贵（AC-9 基线 C）。
 * 2. source 模式同样是常数（`compileProjection` 的 source 分支显式使用它）。
 */
export const EMPTY_REVEAL_IDS: InlineMarkerRevealIds = asRevealIds(Object.freeze([]));

/**
 * 派生当前选区下"应当显形源码标记"的四类内置行内记录 id 集合。
 *
 * @param index - 当前 markdown 范围索引
 * @param selection - 当前选区（折叠光标与范围选区统一按闭区间触及处理）
 * @param showSourceMarkers - 开关值；`true` 表示 marker 恒显，点集无需参与渲染
 */
export function resolveInlineMarkerRevealIds(
  index: MarkdownRangeIndex,
  selection: EditorSelection,
  showSourceMarkers: boolean,
): InlineMarkerRevealIds {
  if (showSourceMarkers) {
    return EMPTY_REVEAL_IDS;
  }
  const ids = new Set<string>();
  for (const range of selection.ranges) {
    for (const record of index.touching(range.from, range.to)) {
      if (!isInlineSourceMarkerKind(record.kind)) {
        continue;
      }
      // 解析未完成（contentRange 缺失）的记录不参与显隐，避免半解析态抖动。
      if (record.contentRange === null) {
        continue;
      }
      ids.add(record.id);
    }
  }
  return ids.size === 0 ? EMPTY_REVEAL_IDS : asRevealIds(sortStrings(ids));
}
