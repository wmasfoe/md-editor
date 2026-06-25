import { useCallback, useState } from "react";
import { formatActionError } from "./controller-errors";

export type RunFileAction = (label: string, action: () => Promise<void> | void) => Promise<void>;

interface UseFileActionControllerOptions {
  readonly showToast: (message: string | null) => void;
}

export function useFileActionController({ showToast }: UseFileActionControllerOptions) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const runFileAction = useCallback<RunFileAction>(async (label, action) => {
    // 文件操作统一在这里管理 loading 和错误提示，避免各个 action 重复处理 finally。
    setPendingAction(label);
    showToast(null);
    try {
      await action();
    } catch (error) {
      showToast(formatActionError(error, "文件操作失败。"));
    } finally {
      setPendingAction(null);
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
