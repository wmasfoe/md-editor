import { useCallback, useRef, useState } from "react";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-ui";

export function useConfirmationController() {
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const confirmationResolver = useRef<((choice: ConfirmationChoice) => void) | null>(null);

  const requestConfirmation = useCallback((nextConfirmation: ConfirmationState) => {
    // 确认弹窗用 Promise 串起文件切换、删除等流程，resolver 只在弹窗打开期间有效。
    return new Promise<ConfirmationChoice>((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation(nextConfirmation);
    });
  }, []);

  const resolveConfirmation = useCallback((choice: ConfirmationChoice) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(choice);
  }, []);

  const hasPendingConfirmation = useCallback(() => confirmationResolver.current !== null, []);

  return {
    confirmation,
    requestConfirmation,
    resolveConfirmation,
    hasPendingConfirmation
  };
}
