/**
 * @file selection.ts
 * @description 选区/偏移钳制工具：把任意偏移与 `EditorSelection` 夹取到当前文档长度内。
 *
 * 保留 `EditorSelection.create(..., mainIndex)` 形态，使多光标与主选区索引在钳制后不漂移。
 */

import { EditorSelection } from "@codemirror/state";

export function clampOffset(offset: number, documentLength: number): number {
  return Math.max(0, Math.min(offset, documentLength));
}

export function clampSelection(
  selection: EditorSelection,
  documentLength: number,
): EditorSelection {
  return EditorSelection.create(
    selection.ranges.map((range) =>
      EditorSelection.range(
        clampOffset(range.anchor, documentLength),
        clampOffset(range.head, documentLength),
      ),
    ),
    selection.mainIndex,
  );
}
