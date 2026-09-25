/**
 * @file bracket-escape.ts
 * @description Tab 跳出括号/link 的**单元判定纯函数**与两个适配器（D-1）。
 *
 * ## 设计动机（Architect 共识评审 pass-1 的 Synthesis）
 * Tab 仲裁横跨两套互不相通的事件系统：CM6 keymap 链（可用自门控 `return false` 责任链）
 * 与表格 widget 的 DOM `keydown` 捕获（**任何 `Prec` 都够不着**）。若在两侧各写一套判定语义，
 * 必然漂移 —— pass-1 的核心误判正是「分布式派发」带来的。
 *
 * 因此：**语义只写一次**（本文件的 `detectBracketUnit`，对 `(text, offset)` 的纯函数），
 * **派发可以分散**（CM6 适配器 + 表格单元格适配器）。纯函数签名从**类型层面**排除了
 * 投影层最危险的错误：用视觉坐标代替文档坐标（PM-2）。
 *
 * ## 统一规则（用户在 deep-interview 中逐态确认）
 *
 * 判据：`from <= offset < to`（`to` = 单元右边界之后一格）→ 光标移到 `to`。
 *
 * | 输入态 | 单元 | 判定 | 结果 |
 * |---|---|---|---|
 * | `foo(\|)` | from=3,to=5 | `3<=4<5` | `foo()\|` |
 * | `foo\|()` | from=3,to=5 | `3<=3<5` | `foo()\|` |
 * | `foo()\|` | from=3,to=5 | `5<5` 不成立 | **null**（规则的不动点） |
 * | `foo(xxx\|xxx)` | from=3,to=11 | 成立 | `foo(xxxxxx)\|`（**非空对也跳，内容不动**） |
 *
 * 补充约定：
 * - 嵌套取**最内层**（跨度最小的匹配对）。
 * - 不平衡括号**fail closed**（不产生配对，返回 null），绝不飞到行尾/文末。
 * - 转义 `\(` `\)` 是字面量，不参与配对。
 * - link / 图片节点（`[文本](url)` / `![alt](src)`）**当一个整体单元**跳到整条右边界。
 * - 「已在右边界则不动」由 `from <= offset < to` 天然给出，无需特例。
 *
 * ## 边界责任
 * 代码块体、行内代码、URL 段、数学段、原子块边界**一律由适配器负责 fail closed**：
 * 适配器只把「纯文本 run」切片交给本纯函数。这是 AGENTS.md 架构边界（判定语义归核心模块，
 * 数据获取/协议适配归接入层）的落地。
 */

/** 判定结果：一个可被 Tab 跳出的单元 */
export interface BracketUnit {
  /** `bracket` = 括号对；`link` = Markdown link / 图片节点（当一个整体） */
  readonly kind: "bracket" | "link";
  /** 单元起点（含） */
  readonly from: number;
  /** 单元右边界之后一格（不含）；调用方把光标移到这里 */
  readonly to: number;
}

/** 需要成对处理的括号（含 CJK）。value 为对应的右括号 */
const PAIR_OPEN_TO_CLOSE: ReadonlyMap<string, string> = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["「", "」"],
  ["『", "』"],
  ["（", "）"],
  ["【", "】"],
  ["《", "》"],
  ["〈", "〉"],
]);

const CLOSE_TO_OPEN: ReadonlyMap<string, string> = new Map(
  [...PAIR_OPEN_TO_CLOSE].map(([open, close]) => [close, open]),
);

/** 奇数个反斜杠结尾 = 该字符被转义 */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** 行内代码 span（`...`）的范围；无法闭合的反引号按字面量处理（fail closed） */
function findInlineCodeSpans(text: string): readonly { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`" && !isEscaped(text, i)) {
      const close = text.indexOf("`", i + 1);
      if (close === -1) {
        break;
      }
      spans.push({ from: i, to: close + 1 });
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return spans;
}

function inAnySpan(offset: number, spans: readonly { from: number; to: number }[]): boolean {
  return spans.some((span) => span.from <= offset && offset < span.to);
}

/**
 * link / 图片节点：`[文本](url)` 与 `![alt](src)`。
 * 目标段允许：普通字符、**成对引号包裹的 title**（可含括号）、以及一层嵌套括号（如 Wikipedia 的 `Foo_(bar)`）。
 * 若用朴素 `[^()]*`，`[a](b "title (x)")` 会匹配失败 → 退化成把 title 里的 `(x)` 当可跳出括号对（U9 回归）。
 */
const LINK_PATTERN = /(!?)\[([^\]]*)\]\(((?:[^()"']|"[^"]*"|'[^']*'|\([^()]*\))*)\)/g;
function detectLinkUnit(text: string, offset: number): BracketUnit | null {
  const pattern = new RegExp(LINK_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  let best: BracketUnit | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const from = match.index;
    const to = match.index + match[0].length;
    if (isEscaped(text, from + (match[1] ? 1 : 0))) {
      continue;
    }
    if (from <= offset && offset < to) {
      const unit: BracketUnit = { kind: "link", from, to };
      // 取最内层：跨度最小者优先（link 之间不嵌套，但可能与括号重叠，见 detectBracketUnit）
      if (best === null || unit.to - unit.from < best.to - best.from) {
        best = unit;
      }
    }
  }
  return best;
}

/**
 * 全部 link / 图片节点范围。
 * 用途：括号扫描时**排除**它们 —— link 是独立语义 run，其内部括号不参与配对。
 * 例：`[a](b "title (x)")` 中的 `(x)` 不得被当成可跳出的括号对。
 */
function collectLinkSpans(text: string): readonly { from: number; to: number }[] {
  const pattern = new RegExp(LINK_PATTERN.source, "g");
  const spans: { from: number; to: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (isEscaped(text, match.index + (match[1] ? 1 : 0))) {
      continue;
    }
    spans.push({ from: match.index, to: match.index + match[0].length });
  }
  return spans;
}

/**
 * 括号对检测：取**最内层**（跨度最小）且满足 `from <= offset < to` 的匹配对。
 * 不平衡的开括号不产生配对（fail closed）。
 */
function detectBracketPair(
  text: string,
  offset: number,
  excludedSpans: readonly { from: number; to: number }[],
): BracketUnit | null {
  const spans = [...findInlineCodeSpans(text), ...excludedSpans];
  const stack: number[] = [];
  let best: BracketUnit | null = null;

  for (let i = 0; i < text.length; i += 1) {
    if (isEscaped(text, i) || inAnySpan(i, spans)) {
      continue;
    }
    const char = text[i];
    const close = PAIR_OPEN_TO_CLOSE.get(char);
    if (close !== undefined) {
      stack.push(i);
      continue;
    }
    if (CLOSE_TO_OPEN.has(char)) {
      // 找最近的匹配开括号；不匹配的右括号按字面量跳过（fail closed）
      let openIndex = -1;
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (PAIR_OPEN_TO_CLOSE.get(text[stack[s] as number]) === char) {
          openIndex = stack[s] as number;
          stack.length = s;
          break;
        }
      }
      if (openIndex === -1) {
        continue;
      }
      const unit: BracketUnit = { kind: "bracket", from: openIndex, to: i + 1 };
      if (unit.from <= offset && offset < unit.to) {
        if (best === null || unit.to - unit.from < best.to - best.from) {
          best = unit;
        }
      }
    }
  }
  // 栈中残留的开括号 = 不平衡 → 不产生配对（fail closed）
  return best;
}

/**
 * **纯函数**：给定一段**纯文本**与光标偏移，返回可跳出的单元；无则 `null`。
 *
 * 只接受 `(text, offset)` —— 调用方负责给出正确的文档坐标切片。
 * 这条签名是 PM-2（视觉坐标误用）的**类型级防线**。
 */
export function detectBracketUnit(text: string, offset: number): BracketUnit | null {
  if (offset < 0 || offset > text.length) {
    return null;
  }
  // link / 图片是更高层的语义单元，优先于括号对（`[文本](url)` 不是两个独立括号对）
  const link = detectLinkUnit(text, offset);
  if (link !== null) {
    return link;
  }
  // 光标不在任何 link 内时，仍须把**全部 link 节点**从括号扫描中排除，
  // 避免把 `[a](b "title (x)")` 里的 `(x)` 当成可跳出的括号对。
  return detectBracketPair(text, offset, collectLinkSpans(text));
}

/**
 * **纯文本 run 切片版（URL 分量）**—— D3「适配器只把纯文本 run 交给纯函数」的落地，
 * 修复终局评审 HIGH-1：spec §13（Wikipedia `Foo_(bar)` 案）要求 **裸 URL 段 fail closed**，
 * 但 range-index 无 bare-URL kind（只有 `<autolink>`），只能正则切片：
 *  - 光标落在裸 URL 内 → `null`（fail closed）；
 *  - 否则按裸 URL 把行切成若干 run，在光标所在 run 内调用 `detectBracketUnit`（坐标回映）——
 *    跨 URL 的括号因此也无法配对（各 run 内不闭合 → fail closed）；
 *  - 位于 link 节点**内部**的 URL 不参与切割（`[t](https://x/a_(b))` 的 href 是 link 整体的一部分，
 *    否则破坏 T9 的 link 整体跳出）；行内无裸 URL 时与 `detectBracketUnit` 完全等价。
 */
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function detectBracketUnitInLineRuns(text: string, offset: number): BracketUnit | null {
  if (offset < 0 || offset > text.length) {
    return null;
  }
  const links = collectLinkSpans(text);
  const urlSpans: { from: number; to: number }[] = [];
  for (const match of text.matchAll(BARE_URL_PATTERN)) {
    const from = match.index;
    if (from === undefined) {
      continue;
    }
    const to = from + match[0].length;
    if (links.some((link) => from >= link.from && to <= link.to)) {
      continue;
    }
    urlSpans.push({ from, to });
  }
  if (urlSpans.length === 0) {
    return detectBracketUnit(text, offset);
  }
  if (urlSpans.some((span) => span.from <= offset && offset < span.to)) {
    return null;
  }
  urlSpans.sort((a, b) => a.from - b.from);
  const segments: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const span of urlSpans) {
    if (span.from > cursor) {
      segments.push({ from: cursor, to: span.from });
    }
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < text.length) {
    segments.push({ from: cursor, to: text.length });
  }
  const segment =
    segments.find((s) => s.from <= offset && offset < s.to) ??
    (offset === text.length ? segments[segments.length - 1] : undefined);
  if (!segment) {
    return null;
  }
  const unit = detectBracketUnit(text.slice(segment.from, segment.to), offset - segment.from);
  return unit === null
    ? null
    : { kind: unit.kind, from: segment.from + unit.from, to: segment.from + unit.to };
}

/**
 * **表格单元格适配器**：cell 文本是 contenteditable 的未提交 DOM 文本，
 * 不是文档坐标空间，故需自带小型解析器 —— 先剔除行内代码 span（边界 fail closed），
 * 再把「纯文本 run」交给同一个纯函数，保证与 CM6 路径**语义单一**。
 */
export function detectBracketUnitInCell(cellText: string, caretOffset: number): BracketUnit | null {
  if (caretOffset < 0 || caretOffset > cellText.length) {
    return null;
  }
  const spans = findInlineCodeSpans(cellText);
  if (inAnySpan(caretOffset, spans) || inAnySpan(caretOffset + 1, spans)) {
    return null;
  }
  // URL 分量与 CM6 腿同一切片语义（语义单一，HIGH-1）
  return detectBracketUnitInLineRuns(cellText, caretOffset);
}
