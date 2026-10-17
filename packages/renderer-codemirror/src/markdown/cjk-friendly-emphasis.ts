/**
 * @file cjk-friendly-emphasis.ts
 * @description CJK 友好的强调定界符解析（CommonMark「CJK-friendly amendments」落地）。
 *
 * ## 问题（本模块存在的原因）
 * CommonMark 用 flanking delimiter run 规则判定 `**` / `*` / `~~` 能否开合，而规则里的
 * 「Unicode 标点」把全角标点（`「」`、`（）`、`。、：`）也算作标点。中文/日文/韩文不用空格
 * 分词，强调标记内外两侧常常直接贴着全角标点，于是两侧同时判定失败：
 *
 * ```text
 * 从**「爆款」**到
 *   ↑ 后接标点 `「`、前接汉字 `从` ⇒ 开定界符不满足 left-flanking
 *              ↑ 前接标点 `」`、后接汉字 `到` ⇒ 闭定界符不满足 right-flanking
 * ```
 *
 * 失败后这一对 `**` 变成字面文本，还会和后面出现的 `**` 跨对错配（例如整行
 * `从**「爆款」**到**「角色锁定」**的完整路径` 会被解析成 `**到**` 加粗），
 * 用户只能手动在标记外侧补空格规避——而补空格会在正文里留下可见空隙。
 *
 * ## 规则来源
 * 采用社区上游的规范修订 https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md
 * （对应 commonmark-spec#650）：把 flanking 判定里的「Unicode 标点」收窄为
 * 「非 CJK 标点」，即 CJK 标点按普通文字对待，并把「CJK 序列」与「表意文字变体选择符
 * （IVS）」补进合法的前置集合。**非 CJK 文本的解析结果与标准 CommonMark 完全一致**，
 * 因此本模块是纯增量兼容，而不是全域放宽。
 *
 * Unicode 分类（东亚宽度 W/F/H 且非默认 emoji 展示、Hangul、IVS、变体选择符、标点类别）
 * 复用规范作者的 `micromark-extension-cjk-friendly-util`，避免自维护 Unicode 表。
 *
 * ## 使用方式
 * - 编辑器语法树：把 {@link cjkFriendlyEmphasisMarkdownExtension} 加进 Markdown 扩展链，
 *   它以同名替换的方式接管 `Emphasis` 与 GFM `Strikethrough` 行内解析器；
 * - 其它自定义定界符语法（如 `==高亮==`）：直接复用 {@link resolveCjkFriendlyDelimiterSides}。
 */

import { InlineContext, type MarkdownConfig } from "@lezer/markdown";
import {
  classifyCharacter,
  classifyPrecedingCharacter,
  isCjk,
  isCjkOrIvs,
  isNonCjkPunctuation,
  isNonEmojiGeneralUseVS,
  isSpaceOrPunctuation,
  isUnicodeWhitespace,
} from "micromark-extension-cjk-friendly-util";

/** micromark 约定的 EOF/行边界码点；分类器把它当作 Unicode 空白。 */
const EOF = -1;

/**
 * 字符分类结果的位标志类型。
 * `micromark-extension-cjk-friendly-util` 未导出其别名（内部为字面量联合），这里从返回值推导，
 * 以便在适配层内保持类型精确、不必到处 `as`。
 */
type CharacterCategory = ReturnType<typeof classifyCharacter>;

const ASTERISK = 42;
const UNDERSCORE = 95;
const TILDE = 126;

/** 定界符种类：`_` 额外禁止词内开合，其余（`*`、`~`、插件自定义 `=`）只做 flanking 判定。 */
export type DelimiterMarker = "*" | "_" | "~" | "=";

/** 定界符两侧的相邻码点。 */
export interface DelimiterNeighbors {
  /** 紧邻定界符之前的码点；行首为 `null`。 */
  readonly before: number | null;
  /** 再往前一个码点；用于识别「标点/CJK + 变体选择符」序列，不足时为 `null`。 */
  readonly beforePrevious: number | null;
  /** 紧邻定界符之后的码点；行尾为 `null`。 */
  readonly after: number | null;
}

/** 定界符的开合能力。 */
export interface DelimiterSides {
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

/**
 * CJK 友好修订版的 flanking 判定。
 *
 * 与 CommonMark 原始规则的唯一差别：`\p{P}` 标点集合里剔除 CJK 标点（按普通文字对待），
 * 并承认 CJK 序列 / IVS 作为合法前置边界。`_` 的词内限制（规则 2/6）保持 CommonMark
 * 语义，只是把「Unicode 标点」换成「Unicode 标点序列」（允许标点后跟变体选择符）。
 */
export function resolveCjkFriendlyDelimiterSides(
  marker: DelimiterMarker,
  neighbors: DelimiterNeighbors,
): DelimiterSides {
  // 前置序列：紧邻的是非 emoji 变体选择符时，回退到基字符分类；
  // 弯引号 `‘’“”` + U+FE01 这类歧义序列由 classifyPrecedingCharacter 归一。
  const beforeCategory = classifyPrecedingCharacterCategory(
    neighbors.before,
    neighbors.beforePrevious,
  );
  const afterCategory = classifyCharacter(neighbors.after ?? EOF);

  const whitespaceBefore = isUnicodeWhitespace(beforeCategory);
  const whitespaceAfter = isUnicodeWhitespace(afterCategory);
  const nonCjkPunctuationBefore = isNonCjkPunctuation(beforeCategory);
  const nonCjkPunctuationAfter = isNonCjkPunctuation(afterCategory);
  const cjkOrVariationBefore = isCjkOrIvs(beforeCategory);
  const cjkAfter = isCjk(afterCategory);

  const leftFlanking =
    !whitespaceAfter &&
    (!nonCjkPunctuationAfter ||
      whitespaceBefore ||
      nonCjkPunctuationBefore ||
      cjkOrVariationBefore);
  const rightFlanking =
    !whitespaceBefore &&
    (!nonCjkPunctuationBefore || whitespaceAfter || nonCjkPunctuationAfter || cjkAfter);

  if (marker !== "_") {
    return { canOpen: leftFlanking, canClose: rightFlanking };
  }

  // 规则 2/6：`_` 只有在「不参与另一侧」或「另一侧是 Unicode 标点序列」时才允许开合，
  // 以避免 `snake_case_name` 这类词内下划线被误判为斜体。
  return {
    canOpen: leftFlanking && (!rightFlanking || isAnyUnicodePunctuation(beforeCategory)),
    canClose: rightFlanking && (!leftFlanking || isAnyUnicodePunctuation(afterCategory)),
  };
}

/**
 * CommonMark 的 `Emphasis` 行内解析器替换实现。
 *
 * 通过 `name: "Emphasis"` 覆盖 lezer-markdown 内置解析器（`configure` 对同名解析器做
 * 原位替换），并复用 1.8.0 起官方导出的 `emphasisAsterisk` / `emphasisUnderscore`
 * 定界符类型，保证后续 `resolveMarkers` 仍按长度拆分 run、执行「规则 3」并产出
 * `Emphasis` / `StrongEmphasis` 节点。
 */
export const cjkFriendlyEmphasisMarkdownExtension: MarkdownConfig = Object.freeze({
  parseInline: Object.freeze([
    Object.freeze({
      name: "Emphasis",
      parse(cx: InlineContext, next: number, position: number) {
        if (next !== ASTERISK && next !== UNDERSCORE) {
          return -1;
        }
        let end = position + 1;
        while (cx.char(end) === next) {
          end++;
        }
        // 反斜杠转义由先注册的 `Escape` 解析器处理，与内置实现保持一致。
        const sides = resolveCjkFriendlyDelimiterSides(
          next === ASTERISK ? "*" : "_",
          readDelimiterNeighbors(cx, position, end),
        );
        return cx.addDelimiter(
          next === ASTERISK ? InlineContext.emphasisAsterisk : InlineContext.emphasisUnderscore,
          position,
          end,
          sides.canOpen,
          sides.canClose,
        );
      },
    }),
  ]),
});

/** GFM `Strikethrough` 的定界符类型；节点名由 `GFM` 扩展定义，此处按名重建。 */
const STRIKETHROUGH_DELIMITER = Object.freeze({
  resolve: "Strikethrough",
  mark: "StrikethroughMark",
});

/**
 * CJK 友好的 GFM 删除线解析器替换实现（`~~文字~~`）。
 *
 * 与强调共用同一套 flanking 判定：`~~` 的错误配对（如 `中~~「删除」~~文`）与 `**` 同源。
 * 需要 `GFM` 扩展在本扩展之前配置，否则 `Strikethrough` 节点类型不存在。
 */
export const cjkFriendlyStrikethroughMarkdownExtension: MarkdownConfig = Object.freeze({
  parseInline: Object.freeze([
    Object.freeze({
      name: "Strikethrough",
      parse(cx: InlineContext, next: number, position: number) {
        if (next !== TILDE || cx.char(position + 1) !== TILDE || cx.char(position + 2) === TILDE) {
          return -1;
        }
        const sides = resolveCjkFriendlyDelimiterSides(
          "~",
          readDelimiterNeighbors(cx, position, position + 2),
        );
        return cx.addDelimiter(
          STRIKETHROUGH_DELIMITER,
          position,
          position + 2,
          sides.canOpen,
          sides.canClose,
        );
      },
      after: "Emphasis",
    }),
  ]),
});

/** CJK 友好的行内定界符扩展集合（强调 + GFM 删除线）。 */
export const CJK_FRIENDLY_MARKDOWN_EXTENSIONS: readonly MarkdownConfig[] = Object.freeze([
  cjkFriendlyEmphasisMarkdownExtension,
  cjkFriendlyStrikethroughMarkdownExtension,
]);

/**
 * 读取定界符两侧的相邻码点。
 *
 * `InlineContext.char` 返回单个 UTF-16 码元，CJK 扩展区（U+20000+）、IVS（U+E0100+）与
 * Emoji 都是代理对，必须自行合成完整码点，否则分类会落在高低代理上而判错。
 */
export function readDelimiterNeighbors(
  cx: InlineContext,
  start: number,
  end: number,
): DelimiterNeighbors {
  const before = codePointEndingAt(cx, start);
  const after = codePointStartingAt(cx, end);
  return {
    before,
    beforePrevious: before === null ? null : codePointEndingAt(cx, start - utf16Length(before)),
    after,
  };
}

/** 读取以 `position` 结尾的完整码点（即紧邻其后的位置之前那个字符）。 */
function codePointEndingAt(cx: InlineContext, position: number): number | null {
  // `InlineContext.char` 只检查右边界，左侧越界会返回 NaN，必须自行按行内区间起点截断
  // （行首按规范等价于 Unicode 空白）。
  if (position <= cx.offset) {
    return null;
  }
  const low = cx.char(position - 1);
  if (low < 0) {
    return null;
  }
  if (!isLowSurrogate(low)) {
    return low;
  }
  const high = cx.char(position - 2);
  return isHighSurrogate(high) ? combineSurrogates(high, low) : low;
}

/** 读取从 `position` 开始的完整码点。 */
function codePointStartingAt(cx: InlineContext, position: number): number | null {
  if (position >= cx.end) {
    return null;
  }
  const high = cx.char(position);
  if (high < 0) {
    return null;
  }
  if (!isHighSurrogate(high)) {
    return high;
  }
  const low = cx.char(position + 1);
  return isLowSurrogate(low) ? combineSurrogates(high, low) : high;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function combineSurrogates(high: number, low: number): number {
  return ((high - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
}

function utf16Length(codePoint: number): number {
  return codePoint > 0xffff ? 2 : 1;
}

/** 前置字符分类：把「基字符 + 非 emoji 变体选择符」归一到基字符类别。 */
function classifyPrecedingCharacterCategory(
  codePoint: number | null,
  previousCodePoint: number | null,
): CharacterCategory {
  const category = classifyCharacter(codePoint ?? EOF);
  if (!isNonEmojiGeneralUseVS(category)) {
    return category;
  }
  return classifyPrecedingCharacter(category, () => previousCodePoint ?? EOF, codePoint ?? EOF);
}

/**
 * 是否为「Unicode 标点」（含 CJK 标点）。
 *
 * `isSpaceOrPunctuation` 覆盖空白与标点两类，排除空白后即标点集合——这样既复用分类器
 * 的位标志，又不引入魔法数字。
 */
function isAnyUnicodePunctuation(category: CharacterCategory): boolean {
  return isSpaceOrPunctuation(category) && !isUnicodeWhitespace(category);
}
