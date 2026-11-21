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
 *
 * `par_over` 也不在集合里：mermaid 的 lexer 有该 token，但 Visimer 的
 * `BLOCK_OPEN_RE`（`/^(alt|opt|loop|par|critical|break|rect|box)\b/`）匹配不到
 * `par_over`，它会以 `unknown` 到达这里，整图在闸门层就会被退回源码。
 */
export const SEQUENCE_BLOCK_KEYWORDS: ReadonlySet<string> = Object.freeze(
  new Set(["alt", "else", "opt", "loop", "par", "and", "critical", "option", "break"]),
);

/**
 * 块条件里的非法字符。Mermaid 的 sequence lexer 把块条件当作 `restOfLine`
 * （`[^#\n;]*`），所以：
 * - `#` 之后整段是注释，写入后会被静默截断（`retry #3` 渲染成 `retry`）；
 * - `;` 等价于换行，会拆出一条新语句（`ok; A->>B: hi` 会多插一条消息）。
 * 两者都能通过 mermaid 的整图解析，因此必须在写入前拒绝，不能只靠草稿校验。
 */
export type SequenceConditionError = "multi-line" | "comment" | "separator";

export function sequenceConditionError(condition: string): SequenceConditionError | null {
  if (/[\r\n]/.test(condition)) return "multi-line";
  if (condition.includes("#")) return "comment";
  if (condition.includes(";")) return "separator";
  return null;
}

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
      // 用 lowercase 查表：mermaid 的 lexer 不区分大小写；Visimer 目前只把小写
      // 关键字标成 blockOpen（`ALT x` 会变成 unknown），这里保持防御性一致。
      if (SEQUENCE_BLOCK_KEYWORDS.has(keyword.toLowerCase())) {
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
      if (SEQUENCE_BLOCK_KEYWORDS.has(keyword.toLowerCase())) {
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
 *
 * `expectedKeyword` 是打开表单时的快照：文档可能在提交前被撤销/外部修改，
 * 行号却仍相同。关键字对不上时拒绝写入，避免把 A 分支的条件写到 B 分支。
 */
export function sequenceBlockConditionEdit(
  result: ParseResult,
  lineIndex: number,
  condition: string,
  expectedKeyword?: string,
): TextEdit | null {
  if (sequenceConditionError(condition)) return null;
  const statement = result.sequence?.statements.get(lineIndex);
  if (statement?.kind !== "blockOpen" && statement?.kind !== "blockMid") return null;
  const keyword = statement.parts[0] ?? "";
  const key = keyword.toLowerCase();
  if (!SEQUENCE_BLOCK_KEYWORDS.has(key)) return null;
  if (expectedKeyword !== undefined && key !== expectedKeyword.toLowerCase()) return null;
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
  return trimmed.slice(0, keyword.length).toLowerCase() === keyword.toLowerCase()
    ? trimmed.slice(keyword.length).trim()
    : "";
}
