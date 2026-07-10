import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  type Transaction as ProseMirrorTransaction,
} from "@milkdown/kit/prose/state";
import { Mapping } from "@milkdown/kit/prose/transform";

/**
 * 仅用于 WYSIWYG（Milkdown / ProseMirror）的引号保真。
 *
 * 当前默认不挂载：macOS 壳层已通过 NSUserDefaults 关闭本 App 的智能引号 /
 * 破折号替换。本模块保留作残留路径的可选兜底，需要时再在
 * MilkdownEditorPrimitive 中恢复 `.use(straightQuotesPlugin)`。
 *
 * 源码模式不需要：CodeMirror 会按键面字符原样写入。
 *
 * 问题背景（contenteditable / WebKit）：
 * - macOS 可能把 ASCII `"` 改写成弯引号 `“`（智能引号），
 *   也包括延后改写，例如输入 `""3` 时回头改第一个引号。
 * - 中文输入法的中文标点会主动插入同一组 Unicode `“”` / `‘’`，必须保留。
 *
 * 策略：
 * - 不要在 keydown 里主动插入（会与系统默认输入路径双插）。
 * - 不要改写「纯插入」的弯引号（中文标点 / 有意输入）。
 * - 仅在已有 ASCII `"` / `'` 被替换成弯引号时还原
 *   （智能引号改写 / 延后改写）。
 * - 另用短生命周期 flag 响应 `insertReplacementText`（自动更正类路径），
 *   但不把普通 `insertText` 的弯引号当成智能引号。
 * - 跳过 paste / drop，保留有意粘贴的弯引号。
 */

const CURLY_DOUBLE_OPEN = "\u201c";
const CURLY_DOUBLE_CLOSE = "\u201d";
const CURLY_SINGLE_OPEN = "\u2018";
const CURLY_SINGLE_CLOSE = "\u2019";

const SMART_TO_STRAIGHT: Readonly<Record<string, string>> = {
  [CURLY_DOUBLE_OPEN]: '"',
  [CURLY_DOUBLE_CLOSE]: '"',
  [CURLY_SINGLE_OPEN]: "'",
  [CURLY_SINGLE_CLOSE]: "'",
};

const straightQuotesPluginKey = new PluginKey("md-editor-straight-quotes");

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

export interface QuoteNormalizationPlan {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface SmartQuoteChangeOptions {
  /**
   * 为 true 时，允许规范化「纯插入」的弯引号。
   * 仅由 `insertReplacementText`（自动更正 / 部分系统替换）短暂置位，
   * 普通中文输入法的 `insertText` 不会打开此开关。
   */
  readonly allowPureSmartInsert?: boolean;
}

export function normalizeSmartQuotes(text: string): string {
  return text
    .replaceAll(CURLY_DOUBLE_OPEN, '"')
    .replaceAll(CURLY_DOUBLE_CLOSE, '"')
    .replaceAll(CURLY_SINGLE_OPEN, "'")
    .replaceAll(CURLY_SINGLE_CLOSE, "'");
}

export function isSmartQuoteCharacter(character: string): boolean {
  return Object.hasOwn(SMART_TO_STRAIGHT, character);
}

/**
 * 判断本次插入的弯引号是否应强制还原为 ASCII。
 *
 * - ASCII 引号被改写成弯引号 → 是（macOS 智能引号 / 延后改写）
 * - 纯插入弯引号 → 否（中文标点），除非 allowPureSmartInsert
 */
export function shouldNormalizeSmartQuoteChange(
  deletedText: string,
  insertedText: string,
  options: SmartQuoteChangeOptions = {},
): boolean {
  if (!insertedText || normalizeSmartQuotes(insertedText) === insertedText) {
    return false;
  }

  // 已有 ASCII 引号被替换成了排版弯引号。
  if (/["']/.test(deletedText)) {
    return true;
  }

  // 仅自动更正类的纯替换路径。
  if (options.allowPureSmartInsert && deletedText.length === 0) {
    return true;
  }

  return false;
}

export function mergeTextRanges(ranges: readonly TextRange[]): TextRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = sortCopy(
    ranges.filter((range) => range.to > range.from),
    (left, right) => left.from - right.from || left.to - right.to,
  );

  if (sorted.length === 0) {
    return [];
  }

  const merged: TextRange[] = [{ ...sorted[0]! }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const last = merged[merged.length - 1]!;
    if (current.from <= last.to) {
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, current.to),
      };
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

/**
 * 在变更区间内规划弯引号 → ASCII 的反向替换。
 * 结果按 from 从高到低排序，便于安全依次应用。
 */
export function planSmartQuoteNormalizationsInRanges(
  doc: ProseMirrorNode,
  ranges: readonly TextRange[],
): QuoteNormalizationPlan[] {
  const plans: QuoteNormalizationPlan[] = [];

  for (const range of mergeTextRanges(ranges)) {
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isText || !node.text) {
        return;
      }

      const text = node.text;
      let index = 0;
      while (index < text.length) {
        const absolute = pos + index;
        if (absolute < range.from) {
          index += 1;
          continue;
        }
        if (absolute >= range.to) {
          return false;
        }

        const straight = SMART_TO_STRAIGHT[text[index]!];
        if (!straight) {
          index += 1;
          continue;
        }

        let end = index + 1;
        let insert = straight;
        while (end < text.length && pos + end < range.to && SMART_TO_STRAIGHT[text[end]!]) {
          insert += SMART_TO_STRAIGHT[text[end]!]!;
          end += 1;
        }

        plans.push({ from: absolute, to: pos + end, insert });
        index = end;
      }
    });
  }

  return sortCopy(plans, (left, right) => right.from - left.from || right.to - left.to);
}

/**
 * 检查每个 replace step：仅当弯引号来自 ASCII 改写
 * （或已武装的 insertReplacementText 纯插入）时才规划还原。
 * 返回的 plan 坐标位于全部 transaction 应用后的最终文档。
 */
export function planSmartQuoteNormalizationsFromTransactions(
  transactions: readonly ProseMirrorTransaction[],
  options: SmartQuoteChangeOptions = {},
): QuoteNormalizationPlan[] {
  const pending: QuoteNormalizationPlan[] = [];

  for (const transaction of transactions) {
    if (!transaction.docChanged) {
      continue;
    }

    // 将更早 transaction 产生的 plan 映射到当前 transaction 的结果坐标系。
    for (let index = 0; index < pending.length; index += 1) {
      const plan = pending[index]!;
      pending[index] = {
        from: transaction.mapping.map(plan.from, -1),
        to: transaction.mapping.map(plan.to, 1),
        insert: plan.insert,
      };
    }

    for (let stepIndex = 0; stepIndex < transaction.steps.length; stepIndex += 1) {
      const docBefore = transaction.docs[stepIndex];
      if (!docBefore) {
        continue;
      }

      const docAfter =
        stepIndex + 1 < transaction.docs.length
          ? transaction.docs[stepIndex + 1]!
          : transaction.doc;
      const stepMap = transaction.steps[stepIndex]!.getMap();
      const mapThroughRestOfTransaction = new Mapping(
        transaction.mapping.maps.slice(stepIndex + 1),
      );

      stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart) {
          return;
        }

        const deletedText =
          oldEnd > oldStart ? docBefore.textBetween(oldStart, oldEnd, "\n", "\0") : "";
        const insertedText = docAfter.textBetween(newStart, newEnd, "\n", "\0");

        if (!shouldNormalizeSmartQuoteChange(deletedText, insertedText, options)) {
          return;
        }

        const localPlans = planSmartQuoteNormalizationsInRanges(docAfter, [
          { from: newStart, to: newEnd },
        ]);

        for (const local of localPlans) {
          pending.push({
            from: mapThroughRestOfTransaction.map(local.from, -1),
            to: mapThroughRestOfTransaction.map(local.to, 1),
            insert: local.insert,
          });
        }
      });
    }
  }

  return sortCopy(
    pending.filter((plan) => plan.to > plan.from),
    (left, right) => right.from - left.from || right.to - left.to,
  );
}

function sortCopy<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  return Array.prototype.sort.call([...values], compare) as T[];
}

export function shouldSkipStraightQuoteNormalization(
  transactions: readonly Pick<ProseMirrorTransaction, "getMeta">[],
): boolean {
  return transactions.some((transaction) => {
    if (transaction.getMeta(straightQuotesPluginKey)) {
      return true;
    }

    // 保留有意粘贴 / 拖放的弯引号。
    if (transaction.getMeta("paste") || transaction.getMeta("uiEvent") === "paste") {
      return true;
    }
    if (transaction.getMeta("uiEvent") === "drop") {
      return true;
    }

    // 避免与 IME composition 的 DOM 更新互相抢改。
    const compositionMeta = transaction.getMeta("composition");
    if (compositionMeta !== null && compositionMeta !== undefined) {
      return true;
    }

    return false;
  });
}

function applyEditorTypingAttributes(element: HTMLElement): void {
  element.setAttribute("autocorrect", "off");
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocomplete", "off");
}

function isSmartQuoteReplacementInput(event: InputEvent): boolean {
  if (event.isComposing) {
    return false;
  }
  // 仅自动更正 / 系统替换路径；中文输入法标点常用普通 insertText。
  if (event.inputType !== "insertReplacementText") {
    return false;
  }
  const data = event.data ?? "";
  return data.length > 0 && normalizeSmartQuotes(data) !== data;
}

export const straightQuotesPlugin = $prose(() => {
  // 仅由 insertReplacementText 武装；在下一次文档变更时消费。
  let pendingReplacementNormalize = false;

  return new Plugin({
    key: straightQuotesPluginKey,
    view(view) {
      applyEditorTypingAttributes(view.dom);
      return {};
    },
    props: {
      handleDOMEvents: {
        beforeinput(_view, event) {
          if (event instanceof InputEvent && isSmartQuoteReplacementInput(event)) {
            pendingReplacementNormalize = true;
          }
          return false;
        },
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (shouldSkipStraightQuoteNormalization(transactions)) {
        pendingReplacementNormalize = false;
        return null;
      }

      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const allowPureSmartInsert = pendingReplacementNormalize;
      pendingReplacementNormalize = false;

      const plans = planSmartQuoteNormalizationsFromTransactions(transactions, {
        allowPureSmartInsert,
      });
      if (plans.length === 0) {
        return null;
      }

      let transaction = newState.tr;
      for (const plan of plans) {
        // 防止映射边界情况下出现过期区间。
        if (plan.from < 0 || plan.to > transaction.doc.content.size || plan.from >= plan.to) {
          continue;
        }
        const current = transaction.doc.textBetween(plan.from, plan.to, "\n", "\0");
        if (normalizeSmartQuotes(current) === current) {
          continue;
        }
        transaction = transaction.insertText(plan.insert, plan.from, plan.to);
      }

      if (!transaction.docChanged) {
        return null;
      }

      // 与用户按键合并为一次历史记录；智能引号还原本身不应再占一步 undo。
      return transaction.setMeta(straightQuotesPluginKey, true).setMeta("addToHistory", false);
    },
  });
});
