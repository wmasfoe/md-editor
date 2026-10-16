/** IME guards and deferred edit notification preserve their original dispatch ordering. */
import { Transaction } from "@codemirror/state";
import {
  endWysiwygCompositionGuardEffect,
  refreshWysiwygProjectionEffect,
  startWysiwygCompositionGuardEffect,
} from "../../wysiwyg/state/types.ts";
import type {
  CodeMirrorRendererOptions,
  ExternalEditRequest,
  RendererViewAdapter,
} from "../types.ts";
export interface CompositionContext {
  readonly view: RendererViewAdapter;
  readonly destroyed: boolean;
  readonly options: Pick<CodeMirrorRendererOptions, "onQueuedExternalEditReady">;
  compositionActive: boolean;
  queuedExternalEdit: ExternalEditRequest | null;
  lastErrorCode: string | null;
}
export function startComposition(context: CompositionContext): void {
  if (context.compositionActive || context.destroyed) {
    return;
  }
  context.compositionActive = true;
  context.view.dispatch({
    effects: startWysiwygCompositionGuardEffect.of(
      context.view.state.selection.ranges.map((range) => ({
        from: range.from,
        to: range.to,
      })),
    ),
    annotations: Transaction.addToHistory.of(false),
  });
}

export function finishComposition(context: CompositionContext): void {
  if (!context.compositionActive) {
    return;
  }
  context.compositionActive = false;
  if (!context.destroyed) {
    context.view.dispatch({
      effects: [
        endWysiwygCompositionGuardEffect.of(null),
        // G004 P0-2:composition 期间投影装饰只 map 未重建,结束必须全量重建一次,
        // 保证装饰与 IME 提交后的最终文档一致。
        refreshWysiwygProjectionEffect.of(null),
      ],
      annotations: Transaction.addToHistory.of(false),
    });
  }
  const request = context.queuedExternalEdit;
  context.queuedExternalEdit = null;
  if (request === null || context.destroyed) {
    return;
  }
  try {
    context.options.onQueuedExternalEditReady(request);
  } catch {
    context.lastErrorCode = "QUEUED_READY_CALLBACK_FAILED";
  }
}
