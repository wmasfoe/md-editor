/**
 * @file coverage.ts
 * @description 解析覆盖度（`MarkdownParseCoverage`）的投影与读取策略。
 *
 * 从 `range-index.ts` 抽出：该文件已触及 renderer 的 800 行硬上限
 * （见 `scripts/structure/check.mjs`），而覆盖度语义是独立且需要单独解释的一块。
 *
 * ## 两种读取策略的分工
 *
 * - {@link projectCoverage}：**增量更新路径**（每次按键）。绝不能阻塞解析，
 *   以上一轮的覆盖度为基准投影。
 * - `range-index.ts` 的 `readCoverageAfterParse`：**低频路径**（字段创建、
 *   覆盖度刷新）。语义上就是「把覆盖度补满」，允许 `ensureSyntaxTree`。
 */
import type { MarkdownParseCoverage } from "@md-editor/plugin-sdk/syntax";

/**
 * 增量更新路径的覆盖度：以**上一次的覆盖度**为基准按变更平移。
 *
 * 为什么不能直接重新测量：CM6 对语法树是**惰性**的 —— `syntaxTree(state)` 在变更
 * 区域之外可能仍是旧的、未随文档增长的视图。刚编辑完时 `tree.length` 常落后于
 * `doc.length`，重新测量会把本该完整的覆盖度误判为 `partial`，进而把
 * `parserCoverage` 降级、让下游投影退化成源码显示（实测：一次插入后，
 * 变更点之后的 `heading-atx` / `bold` 全被标成 `partial`）。
 *
 * 语义：
 * - 原本 `complete` 的索引在增量编辑后**仍然完整** —— 增量更新只重建脏区间，
 *   未变动区域仍由上一轮的记录承担，因此 `to` 直接取文档长度；
 * - 原本 `partial` 的索引保持 `partial`，`to` 不前进（仍需后续补解析）。
 *
 * ⚠️ 不能只把旧 `to` 按变更平移：`coverage.to` 记录的是「被实际遍历过的语法树范围」，
 * 而增量路径不再遍历全文，平移值会永远追不上文档增长（实测 3019 vs 8080），
 * 使变更点之后的记录全部退化为 `parserCoverage: "partial"`，下游投影因此降级成源码显示。
 *
 * 只有 `requiresCompleteParse` 判定需要全量重解析时（MDX / 表格结构编辑 / 覆盖度本就缺失）
 * 才另走 `readCoverageAfterParse`。
 */
export function projectCoverage(
  previous: MarkdownParseCoverage,
  documentLength: number,
): MarkdownParseCoverage {
  // 增量更新**只重建脏区间**，未变动区域继续由上一轮的记录承担；上一轮若已
  // `complete`，这一轮的索引语义上仍覆盖全文 —— 因此 `to` 直接取文档长度。
  //
  // 不能只把旧 `to` 平移：`coverage.to` 记录的是「被实际遍历过的语法树范围」，
  // 而增量路径不再遍历全文，平移值会永远追不上文档增长（实测 3019 vs 8080），
  // 使变更点之后的记录全部退化为 `parserCoverage: "partial"`，下游投影因此
  // 降级成源码显示。
  return Object.freeze({
    to: previous.complete ? documentLength : Math.min(previous.to, documentLength),
    complete: previous.complete,
  });
}
