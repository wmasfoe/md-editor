/**
 * @file record-merge.ts
 * @description 已排序 `MarkdownRangeRecord` 序列的线性归并。
 *
 * 从 `range-index.ts` 抽出：该文件已触及 renderer 的 800 行硬上限
 * （见 `scripts/structure/check.mjs`），且本模块是**纯函数、无状态依赖**的
 * 算法单元，独立成文件更利于单测与复用。
 *
 * ## 为什么需要它
 *
 * `updateMarkdownRangeIndex` 的产物由两段组成：**复用的旧记录**（映射后）与
 * **重建的脏区间记录**。两段各自已按 `compareRecords` 有序。
 *
 * 历史实现用 `insertRecord`（线性插入排序）把每条记录逐条插入新数组 ——
 * O(n²)。CPU profile 显示 3999 条记录时，`insertRecord` + `compareRecords`
 * 占每次按键 48ms 中的 **74%**。改成一次线性归并后降到 ~8.7ms/键。
 */
import type { MarkdownRangeRecord } from "@md-editor/plugin-sdk/syntax";
import { compareRecords } from "./extractors/common.ts";

/**
 * 归并两段已按 `compareRecords` 排序的记录序列（线性时间）。
 *
 * 相等比较返回 0 时优先取 `left`（复用记录），与 `insertRecord` 的
 * `<= 0` 语义保持一致（既有记录先入座）。
 */
export function mergeSortedRecords(
  left: readonly MarkdownRangeRecord[],
  right: readonly MarkdownRangeRecord[],
): MarkdownRangeRecord[] {
  if (right.length === 0) {
    return [...left];
  }
  if (left.length === 0) {
    return [...right];
  }
  const merged: MarkdownRangeRecord[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (compareRecords(left[leftIndex], right[rightIndex]) <= 0) {
      merged.push(left[leftIndex]);
      leftIndex += 1;
    } else {
      merged.push(right[rightIndex]);
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) {
    merged.push(left[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex]);
    rightIndex += 1;
  }
  return merged;
}
