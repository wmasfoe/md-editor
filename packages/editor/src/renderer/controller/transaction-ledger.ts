/**
 * @file transaction-ledger.ts
 * @description 控制器的诊断计数台账：按事务来源分类累计，并供测试探针读取。
 *
 * 计数只增不减（会话级统计），分类口径与拆分前完全一致：
 * `document-*` 由视图更新入口按文档事务数累计，其余按 `RendererTransactionOrigin.kind` 分类；
 * `measureRequestCount` 统计被转发的测量请求。
 */

import type { RendererTransactionOrigin } from "../../origin.ts";

/** 探针中直接展开的事务计数快照（字段名/顺序与被拆分前一致）。 */
export interface TransactionLedgerSnapshot {
  readonly documentTransactionCount: number;
  readonly modeTransactionCount: number;
  readonly externalEditTransactionCount: number;
  readonly reconciliationTransactionCount: number;
  readonly codeBlockLineNumberTransactionCount: number;
  readonly inlineStyleMarkerTransactionCount: number;
  readonly measureRequestCount: number;
}

export class TransactionLedger {
  #documentTransactionCount = 0;
  #modeTransactionCount = 0;
  #externalEditTransactionCount = 0;
  #reconciliationTransactionCount = 0;
  #codeBlockLineNumberTransactionCount = 0;
  #inlineStyleMarkerTransactionCount = 0;
  #measureRequestCount = 0;

  get documentTransactionCount(): number {
    return this.#documentTransactionCount;
  }

  /** 一次视图更新中的全部文档事务。 */
  countDocumentTransactions(count: number): void {
    this.#documentTransactionCount += count;
  }

  /** 被转发到视图层的测量请求。 */
  countMeasure(): void {
    this.#measureRequestCount += 1;
  }

  /** 按事务来源分类计数（未识别来源不计入任何分类，与拆分前一致）。 */
  countOrigin(origin: RendererTransactionOrigin | undefined): void {
    switch (origin?.kind) {
      case "external-edit":
        this.#externalEditTransactionCount += 1;
        break;
      case "reconcile":
        this.#reconciliationTransactionCount += 1;
        break;
      case "mode":
      case "mode-rollback":
        this.#modeTransactionCount += 1;
        break;
      case "code-block-line-numbers":
        this.#codeBlockLineNumberTransactionCount += 1;
        break;
      case "inline-style-markers":
        this.#inlineStyleMarkerTransactionCount += 1;
        break;
    }
  }

  probeFields(): TransactionLedgerSnapshot {
    return {
      documentTransactionCount: this.#documentTransactionCount,
      modeTransactionCount: this.#modeTransactionCount,
      externalEditTransactionCount: this.#externalEditTransactionCount,
      reconciliationTransactionCount: this.#reconciliationTransactionCount,
      codeBlockLineNumberTransactionCount: this.#codeBlockLineNumberTransactionCount,
      inlineStyleMarkerTransactionCount: this.#inlineStyleMarkerTransactionCount,
      measureRequestCount: this.#measureRequestCount,
    };
  }
}
