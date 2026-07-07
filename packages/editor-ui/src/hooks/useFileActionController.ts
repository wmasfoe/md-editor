import { useCallback, useState } from "react";
import { formatActionError } from "./controller-errors";

export type FileActionFeedback = "blocking" | "quiet";

export interface RunFileActionOptions {
  readonly feedback?: FileActionFeedback;
}

export type RunFileAction = (
  label: string,
  action: () => Promise<void> | void,
  options?: RunFileActionOptions
) => Promise<void>;

export function shouldShowFileActionOverlay(options?: RunFileActionOptions): boolean {
  return options?.feedback !== "quiet";
}

interface UseFileActionControllerOptions {
  readonly showToast: (message: string | null) => void;
}

export function useFileActionController({ showToast }: UseFileActionControllerOptions) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const runFileAction = useCallback<RunFileAction>(async (label, action, options) => {
    // 文件操作统一在这里管理错误提示；只有真正阻塞编辑流的动作才显示全局 loading。
    const showOverlay = shouldShowFileActionOverlay(options);
    if (showOverlay) {
      setPendingAction(label);
    }
    showToast(null);
    try {
      await action();
    } catch (error) {
      showToast(formatActionError(error, "文件操作失败。"));
    } finally {
      if (showOverlay) {
        setPendingAction(null);
      }
    }
  }, [showToast]);

  const showFileActionError = useCallback((error: unknown) => {
    showToast(formatActionError(error, "文件操作失败。"));
  }, [showToast]);

  return {
    pendingAction,
    runFileAction,
    showFileActionError
  };
}
