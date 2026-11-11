/** Host hide/show restoration operates on live controller state to reject stale measures. */
import type { RendererViewAdapter } from "../types.ts";
export interface HostVisibilityContext {
  readonly view: RendererViewAdapter;
  readonly destroyed: boolean;
  hiddenViewState: { readonly focused: boolean; readonly scrollTop: number } | null;
  visibilityRestoreSequence: number;
  readonly requestMeasure: (afterMeasure?: () => void) => void;
}
export function setHostVisibility(context: HostVisibilityContext, hidden: boolean): void {
  if (context.destroyed) {
    return;
  }
  if (hidden) {
    context.visibilityRestoreSequence += 1;
    context.hiddenViewState ??= Object.freeze({
      focused: context.view.hasFocus(),
      scrollTop: context.view.getScrollTop(),
    });
    return;
  }

  const previous = context.hiddenViewState;
  if (previous === null) {
    return;
  }
  context.hiddenViewState = null;
  const restoreSequence = ++context.visibilityRestoreSequence;
  if (previous.focused) {
    context.view.focus();
  }
  // CodeMirror may still adjust its scroll anchor during the requested measure.
  context.view.setScrollTop(previous.scrollTop);
  context.requestMeasure(() => {
    if (
      !context.destroyed &&
      context.hiddenViewState === null &&
      restoreSequence === context.visibilityRestoreSequence
    ) {
      context.view.setScrollTop(previous.scrollTop);
    }
  });
}
