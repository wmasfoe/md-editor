import type { LineInfo, ParseResult, TextEdit } from "@visimer/core";

/**
 * 块条件编辑的纯逻辑层（无 DOM、无 Visimer 实例）。
 *
 * 为什么需要这一层：`@visimer/core` 把 `alt` / `else` / `loop` 等关键字行解析成
 * `blockOpen` / `blockMid` 语句，但**不把它们建模成实体**（只有 participant / message / note
 * 有 entityId）。因此画布既不能选中块框，也没有 `seq.setBlockCondition` 这类操作。
 *
 * 关键字行本身仍是普通源码行：只重写「关键字之后的文本」不会影响 mermaid 的块结构，
 * 也不会动消息/参与者的 span。所以块条件通过源码行补丁编辑，并且复用宿主既有的
 * 草稿校验事务（见 `mermaid-draft-editor.ts` 的 `#stage`）。
 */

/**
 * 带条件的块关键字。`rect` 与 `box` 故意排除：
 * - `rect` 后面是颜色参数，不是文案；
 * - `box` 后面是参与者分组标题，语义不同（且没有对应分支）。
 */
export const SEQUENCE_BLOCK_KEYWORDS: ReadonlySet<string> = Object.freeze(
  new Set(["alt", "else", "opt", "loop", "par", "and", "critical", "option", "break"]),
);

export interface SequenceBlockBranch {
  /** 关键字所在源码行的行号（`LineInfo.index`），用于定位补丁。 */
  readonly lineIndex: number;
  readonly keyword: string;
  /** 关键字之后的文案；没有条件时为空串。 */
  readonly condition: string;
  /** 1 = 最外层。仅用于在下拉列表里表达嵌套层级。 */
  readonly depth: number;
}

/**
 * 按源码顺序列出所有可编辑的块分支。
 *
 * `rect` / `box` 仍会入栈（它们也有配对的 `end`），只是不产出可编辑项，
 * 否则其内部块的 depth 会算错。
 */
export function listSequenceBlockBranches(result: ParseResult): readonly SequenceBlockBranch[] {
  const graph = result.sequence;
  if (!graph) return [];
  const branches: SequenceBlockBranch[] = [];
  const stack: string[] = [];
  for (const [lineIndex, statement] of graph.statements) {
    if (statement.kind === "blockOpen") {
      const keyword = statement.parts[0] ?? "";
      // `blockOpen` 一定开启一层嵌套，包括不可编辑的 rect / box。
      if (SEQUENCE_BLOCK_KEYWORDS.has(keyword)) {
        branches.push({
          lineIndex,
          keyword,
          condition: conditionOf(result.lines[lineIndex], keyword),
          depth: stack.length + 1,
        });
      }
      stack.push(keyword);
    } else if (statement.kind === "blockMid") {
      const keyword = statement.parts[0] ?? "";
      if (SEQUENCE_BLOCK_KEYWORDS.has(keyword)) {
        branches.push({
          lineIndex,
          keyword,
          condition: conditionOf(result.lines[lineIndex], keyword),
          depth: stack.length,
        });
      }
    } else if (statement.kind === "end") {
      stack.pop();
    }
  }
  return branches;
}

/**
 * 计算「把某一行块关键字的条件改成 `condition`」所需的最小文本补丁。
 *
 * 返回 `null` 表示该行不是可编辑的块关键字行（调用方应当放弃这次编辑，
 * 而不是猜测偏移量写坏源码）。只改关键字之后的文本：缩进、关键字本身、
 * 行尾之外的所有内容都不动。
 */
export function sequenceBlockConditionEdit(
  result: ParseResult,
  lineIndex: number,
  condition: string,
): TextEdit | null {
  // 条件必须是单行：换行会拆出新的 mermaid 语句，属于结构性改动。
  if (/[\r\n]/.test(condition)) return null;
  const statement = result.sequence?.statements.get(lineIndex);
  if (statement?.kind !== "blockOpen" && statement?.kind !== "blockMid") return null;
  const keyword = statement.parts[0] ?? "";
  if (!SEQUENCE_BLOCK_KEYWORDS.has(keyword)) return null;
  const line = result.lines[lineIndex];
  if (!line) return null;
  // 关键字之后到行尾整段替换（含原有条件）；无条件时不留尾随空格。
  const from = line.start + line.indent.length + keyword.length;
  if (from > line.end) return null;
  const next = condition.trim();
  return { start: from, end: line.end, text: next ? ` ${next}` : "" };
}

/** 源码行里关键字之后的文案（已去首尾空白）。 */
function conditionOf(line: LineInfo | undefined, keyword: string): string {
  if (!line) return "";
  const trimmed = line.text.trimStart();
  return trimmed.startsWith(keyword) ? trimmed.slice(keyword.length).trim() : "";
}
