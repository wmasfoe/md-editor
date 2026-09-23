import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownRangeIndexField, type MarkdownRangeIndex } from "../markdown/range-index.ts";
import type { MarkdownSyntaxKind } from "../markdown/range-types.ts";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";

/**
 * 块级移动(对齐竞品 WYSIWYG 编辑器的块拖拽语义,自研实现):
 *
 * 块范围直接来自 range-index 的块级 record(fullRange 对齐到行边界),
 * 移动事务是纯文本算法:
 * - minimalDocumentChange:首尾公共前缀/后缀保留,CM 增量解析大文档不退化;
 * - 列表缩进归一(normalizedListDrop):拖入列表/调整层级时,缩进按
 *   markdown 列宽(制表符 4 列停靠)对齐,嵌套列表的解析层级不破坏;
 * - 空行数量归一:非列表块间保留 2 个换行,列表项间 1 个;
 * - 单事务完成移动+空白归一,undo 一步恢复。
 *
 * UI(六点拖拽手柄)在另一层;本模块只提供纯逻辑,供命令/手柄/测试复用。
 */

/** 参与块级移动的 record kind(排除 inline 记录) */
const BLOCK_KINDS: ReadonlySet<MarkdownSyntaxKind> = new Set([
  "heading-atx",
  "heading-setext",
  "quote",
  "list-item-unordered",
  "list-item-ordered",
  "task",
  "thematic-break",
  "frontmatter",
  "table",
  "html",
  "mdx-jsx",
  "deferred-code",
  "raw-fallback",
]);

export interface BlockRange {
  /** 块起始(行首) */
  readonly from: number;
  /** 块结束(行尾) */
  readonly to: number;
  /** record kind(ListItem/Task 用于缩进归一) */
  readonly name: string;
  /** 列表项缩进层级(由行首缩进列宽推导) */
  readonly depth?: number;
}

/**
 * 列表行 pattern：组 1 = **容器前缀 + 缩进**（含引用 `>`），组 2 = marker，组 3 = 间隔。
 *
 * 修 B3：此前 marker regex 不容忍容器前缀，`> - x` 不被判为列表行，进而被 `quote`
 * record 的 `fullRange` 覆盖判定呑掉 → 整个引用退化成一块。容忍 `>` 前缀后，
 * 引用内列表与顶层列表**粒度一致**。
 *
 * 同一 pattern 供 `readBlockRanges` 与 `listMarkerMatch` 共用，避免两处语义漂移。
 */
const LIST_LINE_PATTERN = /^(\s*(?:>\s*)*)([-+*]|\d+[.)])(\s+)/u;

/** markdown 列宽:制表符按 4 列停靠展开,其余每字符 1 列 */
function markdownColumnWidth(value: string): number {
  let column = 0;
  for (const character of value) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

/** 从 range-index 的块级 record 生成块范围(按 from 排序,过滤嵌套块) */
/**
 * 缓存键：按 `markdownRangeIndexField` 返回的 index 对象与 `doc` 对象**身份**比对。
 *
 * M11：`readBlockRanges` 被纳入每键热路径（专注模式 ViewPlugin 的 `apply()`），
 * 而其内部是 O(lines × records) 的逐行 `records.find/some`（B5 已证实）。
 * 必须在**模块边界**缓存，而非调用点 —— 否则各调用方会各自重复推导。
 *
 * 正确性依据：CM6 字段值在同一 state 下恒等；doc 未变且 index 未变 ⇒ 派生的块范围未变。
 * `index == null`（无 range-index）时**不缓存**，避免跨 state 误命中。
 * 单槽缓存：当前单视图无互踩；若未来多视图并发，升级为按 index 对象身份的 WeakMap
 *（轮1 评审 LOW-4 已知、显式延后 —— 现状正确仅少一层命中）。
 */
let cachedIndex: unknown = null;
let cachedDoc: unknown = null;
let cachedBlocks: readonly BlockRange[] = [];

export function readBlockRanges(state: EditorState): readonly BlockRange[] {
  const index = state.field(markdownRangeIndexField, false);
  const doc = state.doc;
  if (index !== undefined && index === cachedIndex && doc === cachedDoc) {
    return cachedBlocks;
  }
  const blocks = computeBlockRanges(state, index);
  if (index !== undefined) {
    cachedIndex = index;
    cachedDoc = doc;
    cachedBlocks = blocks;
  }
  return blocks;
}

function computeBlockRanges(
  state: EditorState,
  index: MarkdownRangeIndex | undefined,
): readonly BlockRange[] {
  const doc = state.doc;
  const blocks: BlockRange[] = [];
  const lineCount = doc.lines;
  let lineNumber = 1;
  /**
   * 列表层级栈：记录各层祖先列表项的**内容列**（marker 宽 + 间隔）。
   *
   * 修 B1：此前 depth 用 `Math.floor(缩进列宽 / 2)` 硬编码「2 列 = 1 级」，
   * 但 CommonMark 的层级取决于**父级 marker 的内容列**（`- ` = 2、`1. ` = 3、`10. ` = 4），
   * 导致 `10. ` 的子项得 depth 2（应为 1）、`1. ` 三层嵌套得 [0,1,3]（应为 [0,1,2]）。
   * 改用祖先内容列栈推导：先弹出所有「子项缩进不及其内容列」的祖先，再取栈深为层级。
   */
  const ancestorContentColumns: number[] = [];
  while (lineNumber <= lineCount) {
    const line = doc.line(lineNumber);
    if (line.length === 0) {
      lineNumber += 1;
      continue;
    }
    // 列表项行:每行一块(嵌套列表的每个 ListItem 行独立,缩进层级由行首推导)。
    // range-index 会把整棵嵌套列表合并进第一个 ListItem 记录,不能直接依赖记录粒度。
    const marker = LIST_LINE_PATTERN.exec(line.text);
    if (marker) {
      const indentColumns = markdownColumnWidth(marker[1]);
      const contentColumns = indentColumns + markdownColumnWidth(marker[2] + marker[3]);
      while (
        ancestorContentColumns.length > 0 &&
        indentColumns < (ancestorContentColumns.at(-1) ?? 0)
      ) {
        ancestorContentColumns.pop();
      }
      const depth = ancestorContentColumns.length;
      ancestorContentColumns.push(contentColumns);
      blocks.push({
        from: line.from,
        to: line.to,
        name: "list-item",
        depth,
      });
      lineNumber += 1;
      continue;
    }
    // 非列表块会中断列表连续性：重置层级栈，避免下一个无关列表继承旧层级
    ancestorContentColumns.length = 0;
    // 被块级 record 覆盖的行:整块一块(标题/引用/代码块/表格/HTML/MDX/分割线)
    const covering = index?.records.find(
      (record) =>
        BLOCK_KINDS.has(record.kind) &&
        record.fullRange.from <= line.from &&
        record.fullRange.to >= line.to,
    );
    if (covering) {
      const fromLine = doc.lineAt(covering.fullRange.from);
      const toLine = doc.lineAt(covering.fullRange.to);
      blocks.push({ from: fromLine.from, to: toLine.to, name: covering.kind });
      lineNumber = toLine.number + 1;
      continue;
    }
    // 未覆盖的连续非空行:段落块(段落没有可视化投影,range-index 不建记录)
    let endLine = lineNumber;
    while (endLine < lineCount) {
      const nextLine = doc.line(endLine + 1);
      if (nextLine.length === 0) {
        break;
      }
      const nextCovered =
        index?.records.some(
          (record) =>
            BLOCK_KINDS.has(record.kind) &&
            record.fullRange.from <= nextLine.from &&
            record.fullRange.to >= nextLine.to,
        ) ?? false;
      const nextMarker = /^(\s*)([-+*]|\d+[.)])(\s+)/.test(nextLine.text);
      if (nextCovered || nextMarker) {
        break;
      }
      endLine += 1;
    }
    blocks.push({ from: line.from, to: doc.line(endLine).to, name: "paragraph" });
    lineNumber = endLine + 1;
  }
  return blocks;
}

function blockByFrom(state: EditorState, from: number): BlockRange | null {
  return readBlockRanges(state).find((range) => range.from === from) ?? null;
}

function minimalDocumentChange(
  current: string,
  next: string,
): {
  from: number;
  insert: string;
  to: number;
} {
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) {
    from += 1;
  }
  let currentTo = current.length;
  let nextTo = next.length;
  while (currentTo > from && nextTo > from && current[currentTo - 1] === next[nextTo - 1]) {
    currentTo -= 1;
    nextTo -= 1;
  }
  return { from, insert: next.slice(from, nextTo), to: currentTo };
}

function listMarkerMatch(state: EditorState, block: BlockRange): RegExpExecArray | null {
  return LIST_LINE_PATTERN.exec(state.doc.lineAt(block.from).text);
}

function findLastListBlockAtDepth(
  blocks: readonly BlockRange[],
  depth: number,
): BlockRange | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.name === "list-item" && block.depth === depth) {
      return block;
    }
  }
  return undefined;
}

export type BlockDropSide = "before" | "after";

interface NormalizedDrop {
  readonly depth: number;
  readonly indentation: string;
}

/**
 * 列表项落点缩进归一:横向指针移动可能请求一个不存在的层级,
 * 钳制到"上一个同级/父级存在"的合法深度,保证移动后的 `-` 仍是可解析的列表 marker。
 */
function normalizedListDrop(
  state: EditorState,
  blocks: readonly BlockRange[],
  source: BlockRange,
  target: BlockRange,
  side: BlockDropSide,
  requestedDepth: number,
): NormalizedDrop {
  const stationary = blocks.filter((block) => block.from < source.from || block.from >= source.to);
  const targetIndex = stationary.findIndex((block) => block.from === target.from);
  const previous = side === "after" ? target : (stationary[targetIndex - 1] ?? null);
  const maximumDepth =
    previous !== null && isListItemBlock(previous)
      ? (previous.depth ?? 0) + 1
      : isListItemBlock(target)
        ? (target.depth ?? 0)
        : 0;
  const depth = Math.min(Math.max(0, requestedDepth), maximumDepth);

  const sameLevel = [target, previous].find(
    (block) => isListItemBlock(block) && block.depth === depth,
  );
  if (sameLevel) {
    return { depth, indentation: listMarkerMatch(state, sameLevel)?.[1] ?? "" };
  }

  const contextEnd = side === "after" ? targetIndex : targetIndex - 1;
  const preceding = stationary.slice(0, contextEnd + 1);
  const parent = findLastListBlockAtDepth(preceding, depth - 1);
  const parentMarker = parent ? listMarkerMatch(state, parent) : null;
  if (parentMarker) {
    return {
      depth,
      // 有序列表 marker 需要比 `- ` 更宽的缩进;按父级实际内容列对齐,
      // 而不是假设两空格(markdown 制表符展开 4 列,字符串长度会缩进不足)。
      indentation: " ".repeat(markdownColumnWidth(parentMarker[0])),
    };
  }

  const reference = findLastListBlockAtDepth(preceding, depth);
  return {
    depth,
    indentation: reference
      ? (listMarkerMatch(state, reference)?.[1] ?? "  ".repeat(depth))
      : "  ".repeat(depth),
  };
}

function isListItemBlock(block: BlockRange): boolean {
  return block.name === "list-item";
}

/**
 * 移动块:sourceFrom 处的块移动到 targetFrom 处的块之前/之后。
 * 列表项/移入列表时按 targetDepth 做缩进归一;非列表块间空行数量归一为 2。
 * 返回是否产生变更(单事务,undo 一步恢复)。
 */
export function moveBlock(
  view: EditorView,
  sourceFrom: number,
  targetFrom: number,
  side: BlockDropSide,
  targetDepth?: number,
): boolean {
  const blocks = readBlockRanges(view.state);
  const source = blocks.find((block) => block.from === sourceFrom);
  const target = blocks.find((block) => block.from === targetFrom);
  if (!source || !target) {
    return false;
  }
  if (source.from === target.from || (target.from > source.from && target.from < source.to)) {
    return false;
  }

  const document = view.state.doc.toString();
  const movingIntoList = !isListItemBlock(source) && isListItemBlock(target);
  const drop =
    targetDepth !== undefined && (isListItemBlock(source) || movingIntoList)
      ? normalizedListDrop(view.state, blocks, source, target, side, targetDepth)
      : null;
  let sourceMarkdown = document.slice(source.from, source.to);
  if (isListItemBlock(source) && drop) {
    const sourceIndentation = /^[\t ]*/.exec(sourceMarkdown)?.[0] ?? "";
    const indentationDelta =
      markdownColumnWidth(drop.indentation) - markdownColumnWidth(sourceIndentation);
    if (indentationDelta !== 0) {
      sourceMarkdown = sourceMarkdown
        .split("\n")
        .map((line) => {
          const indentation = /^[\t ]*/.exec(line)?.[0] ?? "";
          const nextIndentation = Math.max(0, markdownColumnWidth(indentation) + indentationDelta);
          return `${" ".repeat(nextIndentation)}${line.slice(indentation.length)}`;
        })
        .join("\n");
    }
  }
  if (movingIntoList) {
    const targetLine = view.state.doc.lineAt(target.from).text;
    const marker = /^(\s*)([-+*]|\d+[.)])\s+/u.exec(targetLine);
    if (marker) {
      const indentation = drop?.indentation ?? marker[1] ?? "";
      const sourceMarker = marker[2] ?? "-";
      const prefix = `${indentation}${sourceMarker} `;
      const continuation = `${indentation}${" ".repeat(sourceMarker.length + 1)}`;
      sourceMarkdown = sourceMarkdown
        .split("\n")
        .map((line, index) => (index === 0 ? `${prefix}${line}` : `${continuation}${line}`))
        .join("\n");
    }
  }

  let deletionFrom = source.from;
  let deletionTo = source.to;
  if (deletionTo < document.length) {
    while (document[deletionTo] === "\n") {
      deletionTo += 1;
    }
  } else {
    while (deletionFrom > 0 && document[deletionFrom - 1] === "\n") {
      deletionFrom -= 1;
    }
  }
  const targetPosition = side === "before" ? target.from : target.to;
  if (targetPosition > deletionFrom && targetPosition < deletionTo) {
    return false;
  }

  const withoutSource = document.slice(0, deletionFrom) + document.slice(deletionTo);
  const mappedTarget =
    targetPosition <= deletionFrom ? targetPosition : targetPosition - (deletionTo - deletionFrom);
  const tight = (isListItemBlock(source) || movingIntoList) && isListItemBlock(target);
  const requiredBreaks = tight ? 1 : 2;
  let leftBreaks = 0;
  for (let index = mappedTarget - 1; index >= 0 && withoutSource[index] === "\n"; index -= 1) {
    leftBreaks += 1;
  }
  let rightBreaks = 0;
  for (
    let index = mappedTarget;
    index < withoutSource.length && withoutSource[index] === "\n";
    index += 1
  ) {
    rightBreaks += 1;
  }
  const prefix = mappedTarget > 0 ? "\n".repeat(Math.max(0, requiredBreaks - leftBreaks)) : "";
  const suffix =
    mappedTarget < withoutSource.length
      ? "\n".repeat(Math.max(0, requiredBreaks - rightBreaks))
      : "";
  const inserted = `${prefix}${sourceMarkdown}${suffix}`;
  const nextDocument =
    withoutSource.slice(0, mappedTarget) + inserted + withoutSource.slice(mappedTarget);
  if (nextDocument === document) {
    return false;
  }
  const insertedFrom = mappedTarget + prefix.length;
  view.dispatch({
    // 保留未变的前后缀,CM 在长文档嵌套列表移动后可增量保留解析树
    changes: minimalDocumentChange(document, nextDocument),
    scrollIntoView: true,
    selection: EditorSelection.cursor(insertedFrom),
    userEvent: "move",
    // H2：结构性变更必须标注受保护事务，否则触及 protectedRanges
    // （标题/代码围栏/表格/HTML/MDX/Frontmatter）时会被静默拒绝。
    // 此前块操作 dispatch 缺该注解，导致对这些块的移动被静默 no-op。
    annotations: [authorizeWysiwygProtectedChange.of(true)],
  });
  view.focus();
  return true;
}

/** 在块下方插入空行并返回插入位置(供"添加块"命令使用,菜单由宿主接管) */
export function addBlockBelow(view: EditorView, blockFrom: number): boolean {
  const block = blockByFrom(view.state, blockFrom);
  if (!block) {
    return false;
  }
  view.dispatch({
    changes: { from: block.to, insert: "\n\n" },
    selection: EditorSelection.cursor(block.to + 1),
    scrollIntoView: true,
    userEvent: "input",
    annotations: [authorizeWysiwygProtectedChange.of(true)],
  });
  view.focus();
  return true;
}

/**
 * D-3 块操作命令的 renderer 纯逻辑（供 `bridge.ts` 的 ports 与测试复用）。
 *
 * 全部只经 `moveBlock` / 事务操作**文档坐标**，与拖拽手柄共用同一套块范围语义
 * （缩进归一、空行归一、单事务 undo 一步恢复）。
 */

/** 光标所在块的下标；未命中返回 -1 */
function activeBlockIndex(blocks: readonly BlockRange[], head: number): number {
  return blocks.findIndex((block) => block.from <= head && head <= block.to);
}

/** 上移块：与拖拽到上一块之前同义 */
export function moveBlockUp(view: EditorView): boolean {
  const blocks = readBlockRanges(view.state);
  const index = activeBlockIndex(blocks, view.state.selection.main.head);
  const source = blocks[index];
  const target = blocks[index - 1];
  if (index <= 0 || source === undefined || target === undefined) {
    return false;
  }
  return moveBlock(view, source.from, target.from, "before");
}

/** 下移块：与拖拽到下一块之后同义 */
export function moveBlockDown(view: EditorView): boolean {
  const blocks = readBlockRanges(view.state);
  const index = activeBlockIndex(blocks, view.state.selection.main.head);
  const source = blocks[index];
  const target = blocks[index + 1];
  if (index < 0 || source === undefined || target === undefined) {
    return false;
  }
  return moveBlock(view, source.from, target.from, "after");
}

/** 复制块：在本块之后插入「空行 + 副本」（空行归一），光标落在副本末尾 */
export function duplicateBlock(view: EditorView): boolean {
  const blocks = readBlockRanges(view.state);
  const block = blocks[activeBlockIndex(blocks, view.state.selection.main.head)];
  if (block === undefined) {
    return false;
  }
  const text = view.state.sliceDoc(block.from, block.to);
  const insert = `\n\n${text}`;
  view.dispatch({
    changes: { from: block.to, to: block.to, insert },
    selection: EditorSelection.cursor(block.to + insert.length),
    userEvent: "input.duplicate",
    annotations: [authorizeWysiwygProtectedChange.of(true)],
  });
  return true;
}

/**
 * 删除块：连同其后的分隔空行一并删除（空行归一），undo 可完整恢复。
 * 单事务完成 → undo 一步恢复。
 */
export function deleteBlock(view: EditorView): boolean {
  const blocks = readBlockRanges(view.state);
  const index = activeBlockIndex(blocks, view.state.selection.main.head);
  const block = blocks[index];
  if (block === undefined) {
    return false;
  }
  const doc = view.state.doc;
  // 吃掉本块之后的分隔空行；若是最后一块则回看吃掉其前的分隔空行
  let to = block.to;
  while (to < doc.length && view.state.sliceDoc(to, to + 1) === "\n") {
    to += 1;
  }
  let from = block.from;
  if (to >= doc.length) {
    while (from > 0 && view.state.sliceDoc(from - 1, from) === "\n") {
      from -= 1;
    }
  }
  // 不变量：`to` 由上方循环按 doc 行界推导，恒 ≤ doc.length ——
  // 原 `if (to > doc.length) return false` 为死代码（code-review LOW 处置，已删除）。
  view.dispatch({
    changes: { from, to },
    selection: EditorSelection.cursor(from),
    userEvent: "delete.block",
    annotations: [authorizeWysiwygProtectedChange.of(true)],
  });
  return true;
}
