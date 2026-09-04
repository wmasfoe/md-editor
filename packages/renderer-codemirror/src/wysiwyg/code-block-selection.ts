import { EditorSelection, EditorState, Prec, Transaction, type Extension } from "@codemirror/state";
import {
  Direction,
  EditorView,
  getDrawSelectionConfig,
  layer,
  RectangleMarker,
} from "@codemirror/view";
import { editorModeField } from "../mode.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { getFencedCodeBlockBodyRange, isProjectableCodeBlock } from "./code-block-projection.ts";

/**
 * 计算 view.scrollDOM 的基准偏移量（与 CodeMirror 内部 getBase 逻辑一致）
 */
function getBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left =
    view.textDirection === Direction.LTR ? rect.left : rect.right - view.scrollDOM.clientWidth;
  return {
    left: left - view.scrollDOM.scrollLeft,
    top: rect.top - view.scrollDOM.scrollTop,
  };
}

interface CodeBlockBodySegment {
  readonly from: number;
  readonly to: number;
  readonly record: MarkdownRangeRecord;
}

/**
 * 查找与选区相交的所有围栏代码块主体区间
 */
function findIntersectingCodeBlocks(
  state: EditorState,
  from: number,
  to: number,
): readonly CodeBlockBodySegment[] {
  const index = state.field(markdownRangeIndexField, false);
  if (!index) return [];

  const candidates = index.overlapping(from, to).filter(isProjectableCodeBlock);
  const segments: CodeBlockBodySegment[] = [];

  for (const record of candidates) {
    const bodyRange = getFencedCodeBlockBodyRange(state, record);
    if (!bodyRange || bodyRange.from >= bodyRange.to) continue;
    if (from < bodyRange.to && to > bodyRange.from) {
      segments.push({
        from: bodyRange.from,
        to: bodyRange.to,
        record,
      });
    }
  }

  return segments.toSorted((a, b) => a.from - b.from);
}

interface RangePartition {
  readonly from: number;
  readonly to: number;
  readonly isCodeBlock: boolean;
}

/**
 * 将连续选区按代码块主体边界切割，确保每个子区间要么完全位于代码块内，要么完全位于普通正文内
 */
function partitionRangeByCodeBlocks(
  from: number,
  to: number,
  codeBlocks: readonly CodeBlockBodySegment[],
): readonly RangePartition[] {
  if (codeBlocks.length === 0) {
    return [{ from, to, isCodeBlock: false }];
  }

  const partitions: RangePartition[] = [];
  let current = from;

  for (const block of codeBlocks) {
    const blockStart = Math.max(from, block.from);
    const blockEnd = Math.min(to, block.to);

    if (current < blockStart) {
      partitions.push({ from: current, to: blockStart, isCodeBlock: false });
    }

    if (blockStart < blockEnd) {
      partitions.push({ from: blockStart, to: blockEnd, isCodeBlock: true });
    }

    current = Math.max(current, blockEnd);
  }

  if (current < to) {
    partitions.push({ from: current, to, isCodeBlock: false });
  }

  return partitions;
}

/**
 * 为代码块内的子选区生成并校准选区矩形：
 * 消除 CodeMirror 官方 rectanglesForRange 默认以编辑器全局 leftSide (88px 卡片外边框)
 * 绘制中间行与末行的假定，将其统一校准至代码字符起始列（textLeft），与首行选中态保持严格一致。
 */
function computeCodeBlockMarkers(
  view: EditorView,
  partitionFrom: number,
  partitionTo: number,
  base: { left: number; top: number },
): readonly RectangleMarker[] {
  const range = EditorSelection.range(partitionFrom, partitionTo);
  const rawMarkers = RectangleMarker.forRange(view, "cm-selectionBackground", range);

  // 测量当前代码块内可见代码行的文本起始列坐标 textLeft
  let textLeft: number | null = null;
  const startLine = view.state.doc.lineAt(partitionFrom);
  const endLine = view.state.doc.lineAt(partitionTo);

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum);
    const coords = view.coordsAtPos(line.from);
    if (coords) {
      textLeft = coords.left - base.left;
      break;
    }
  }

  if (textLeft === null) {
    return rawMarkers;
  }

  const calibrated: RectangleMarker[] = [];
  for (const marker of rawMarkers) {
    // 若矩形左边缘小于 textLeft（表明取了未缩进的 card border 88px），向右收敛至 textLeft
    if (marker.left < textLeft - 0.5) {
      const delta = textLeft - marker.left;
      const newWidth = marker.width !== null ? Math.max(0, marker.width - delta) : null;
      calibrated.push(
        new RectangleMarker(
          "cm-selectionBackground",
          textLeft,
          marker.top,
          newWidth,
          marker.height,
        ),
      );
    } else {
      calibrated.push(marker);
    }
  }

  return calibrated;
}

/**
 * 具有代码块感知与多行对齐能力的选区渲染图层
 */
export const codeBlockSelectionLayer = layer({
  above: false,
  markers(view) {
    const markers: RectangleMarker[] = [];
    const base = getBase(view);
    const { ranges } = view.state.selection;

    for (const range of ranges) {
      if (range.empty) continue;

      const codeBlocks = findIntersectingCodeBlocks(view.state, range.from, range.to);
      if (codeBlocks.length === 0) {
        for (const marker of RectangleMarker.forRange(view, "cm-selectionBackground", range)) {
          markers.push(marker);
        }
        continue;
      }

      const partitions = partitionRangeByCodeBlocks(range.from, range.to, codeBlocks);
      for (const part of partitions) {
        if (part.from >= part.to) continue;
        if (part.isCodeBlock) {
          const codeMarkers = computeCodeBlockMarkers(view, part.from, part.to, base);
          for (const marker of codeMarkers) {
            markers.push(marker);
          }
        } else {
          const partRange = EditorSelection.range(part.from, part.to);
          for (const marker of RectangleMarker.forRange(
            view,
            "cm-selectionBackground",
            partRange,
          )) {
            markers.push(marker);
          }
        }
      }
    }

    return markers;
  },
  update(update) {
    return update.docChanged || update.selectionSet || update.geometryChanged;
  },
  class: "cm-selectionLayer",
});

/**
 * 跨块选区原子扩展事务过滤器：
 * 当选区处于非空（非折叠光标）状态且跨越或触碰围栏代码块边界时，
 * 自动将选区中包含该代码块的部分扩展至整个代码块（record.sourceBlockRange，若有尾随换行则包含换行），
 * 使得鼠标拖选、Shift+方向键等交互在涉及代码块时以整块原子选中；
 * 若选区完全处于代码块内部主体（bodyRange）中，则不做任何扩展，保留用户在代码块内的正常文本编辑体验。
 */
export const codeBlockAtomicSelectionFilter: Extension = EditorState.transactionFilter.of(
  (transaction) => {
    // 仅在 WYSIWYG 模式且未修改文档时处理选区扩展；排除由工具栏触发的精确主体选择
    if (
      transaction.docChanged ||
      transaction.startState.field(editorModeField, false) === "source" ||
      transaction.isUserEvent("select.code-block-body")
    ) {
      return transaction;
    }

    const index = transaction.startState.field(markdownRangeIndexField, false);
    if (!index) {
      return transaction;
    }

    const selection = transaction.newSelection;
    if (selection.ranges.every((range) => range.empty)) {
      return transaction;
    }

    let modified = false;
    const doc = transaction.startState.doc;
    const nextRanges = selection.ranges.map((range) => {
      if (range.empty) {
        return range;
      }

      const codeBlocks = index.overlapping(range.from, range.to).filter(isProjectableCodeBlock);
      if (codeBlocks.length === 0) {
        return range;
      }

      let expandedAnchor = range.anchor;
      let expandedHead = range.head;
      let rangeChanged = false;

      for (const record of codeBlocks) {
        const sourceBlockRange = record.codeBlock?.sourceBlockRange ?? record.fullRange;
        const bodyRange = getFencedCodeBlockBodyRange(transaction.startState, record);

        // 仅当选区与代码块源码范围相交时才处理
        const intersectsBlock =
          range.from < sourceBlockRange.to && range.to > sourceBlockRange.from;
        if (!intersectsBlock) {
          continue;
        }

        // 若选区完全位于代码块主体内（且非空），保持代码主体内正常多行/单词文本选择
        const isStrictlyInsideBody =
          record.codeBlock?.blockKind === "fenced"
            ? bodyRange !== null &&
              bodyRange.from < bodyRange.to &&
              range.from >= bodyRange.from &&
              range.to <= bodyRange.to
            : (record.codeBlock?.bodySegments.length ?? 0) > 0 &&
              range.from >= record.codeBlock!.bodySegments[0].from &&
              range.to <=
                (record.codeBlock!.bodySegments.at(-1)?.to ?? record.codeBlock!.bodySegments[0].to);

        if (isStrictlyInsideBody) {
          continue;
        }

        // 代码块整块范围（若尾随换行存在则包含换行，确保删除时整行干净移除）
        const blockFrom = sourceBlockRange.from;
        const hasTrailingNewline =
          sourceBlockRange.to < doc.length &&
          doc.sliceString(sourceBlockRange.to, sourceBlockRange.to + 1) === "\n";
        const blockTo = hasTrailingNewline ? sourceBlockRange.to + 1 : sourceBlockRange.to;

        if (range.anchor <= range.head) {
          // 正向划选（从前往后 / 从上往下）
          const targetAnchor = Math.min(expandedAnchor, blockFrom);
          const targetHead = Math.max(expandedHead, blockTo);
          if (targetAnchor !== expandedAnchor || targetHead !== expandedHead) {
            expandedAnchor = targetAnchor;
            expandedHead = targetHead;
            rangeChanged = true;
          }
        } else {
          // 反向划选（从后往前 / 从下往上）
          const targetAnchor = Math.max(expandedAnchor, blockTo);
          const targetHead = Math.min(expandedHead, blockFrom);
          if (targetAnchor !== expandedAnchor || targetHead !== expandedHead) {
            expandedAnchor = targetAnchor;
            expandedHead = targetHead;
            rangeChanged = true;
          }
        }
      }

      if (rangeChanged) {
        modified = true;
        return EditorSelection.range(expandedAnchor, expandedHead);
      }
      return range;
    });

    if (!modified) {
      return transaction;
    }

    const userEvent = transaction.annotation(Transaction.userEvent);
    return {
      selection: EditorSelection.create(nextRanges, selection.mainIndex),
      effects: transaction.effects,
      ...(userEvent ? { userEvent } : {}),
      scrollIntoView: transaction.scrollIntoView,
    };
  },
);

/**
 * 自绘光标层：在编辑器获焦时绘制光标并在选区变更时触发闪烁动画
 */
export const cursorLayer = layer({
  above: true,
  markers(view) {
    const { state } = view;
    const conf = getDrawSelectionConfig(state);
    const cursors: RectangleMarker[] = [];
    for (const r of state.selection.ranges) {
      const prim = r === state.selection.main;
      if (r.empty || conf.drawRangeCursor) {
        const className = prim ? "cm-cursor cm-cursor-primary" : "cm-cursor cm-cursor-secondary";
        const cursor = r.empty ? r : EditorSelection.cursor(r.head, r.assoc);
        for (const piece of RectangleMarker.forRange(view, className, cursor)) {
          cursors.push(piece);
        }
      }
    }
    return cursors;
  },
  update(update, dom) {
    if (update.transactions.some((tr) => tr.selection)) {
      dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
    }
    return update.docChanged || update.selectionSet;
  },
  mount(dom, view) {
    const conf = getDrawSelectionConfig(view.state);
    dom.style.animationDuration = `${conf.cursorBlinkRate}ms`;
  },
  class: "cm-cursorLayer",
});

/**
 * 隐藏浏览器原生选区与文本光标，由自绘选区层和自绘光标层完全接管
 */
export const hideNativeSelection = Prec.highest(
  EditorView.theme({
    ".cm-line": {
      "& ::selection, &::selection": { backgroundColor: "transparent !important" },
      caretColor: "transparent !important",
    },
  }),
);

/**
 * 代码块选区校准、自绘光标与原子扩展扩展集合
 */
export const codeBlockSelectionExtension: Extension = [
  codeBlockSelectionLayer,
  cursorLayer,
  hideNativeSelection,
  codeBlockAtomicSelectionFilter,
];
