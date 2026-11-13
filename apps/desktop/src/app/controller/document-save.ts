/** Desktop presentation of the platform-independent save result. */
import type { SaveOutcome, SettleSaveResult } from "@md-editor/core";
import { t } from "@md-editor/i18n";

/**
 * 将保存结果转化为国际化 Toast 提示文案。
 *
 * @param outcome 底层落盘裁决
 * @param settlement 状态机结算结果
 * @returns 提示文案，若无需提示则返回 null
 */
export function getSaveFeedback(outcome: SaveOutcome, settlement: SettleSaveResult): string | null {
  if (outcome.status === "cancelled" || outcome.status === "superseded-before-commit") {
    return null;
  }
  if (outcome.status === "indeterminate") {
    return t("toasts.saveUncertain");
  }
  if (outcome.status === "failed") {
    return t("toasts.saveFailed", { error: outcome.errorCode });
  }
  if (settlement.status !== "applied" && settlement.status !== "promoted") {
    return null;
  }

  const warning = outcome.warnings.map((entry) => entry.message).join("；");
  return warning ? t("toasts.saveWarning", { warning }) : null;
}
