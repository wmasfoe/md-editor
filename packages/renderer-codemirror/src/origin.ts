import { Annotation, type Transaction } from "@codemirror/state";

export type RendererTransactionOrigin =
  | { readonly kind: "external-edit"; readonly operationId: string }
  | { readonly kind: "reconcile" }
  | { readonly kind: "mode"; readonly operationId: string }
  | { readonly kind: "mode-rollback"; readonly operationId: string }
  | { readonly kind: "line-numbers" };

export const rendererTransactionOrigin = Annotation.define<RendererTransactionOrigin>();

export function readRendererTransactionOrigin(
  transaction: Transaction,
): RendererTransactionOrigin | undefined {
  return transaction.annotation(rendererTransactionOrigin);
}
