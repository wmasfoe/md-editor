import { useCallback, useState } from "react";

interface ToastState {
  readonly id: number;
  readonly message: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string | null) => {
    if (!message) {
      setToast(null);
      return;
    }
    setToast({ id: Date.now(), message });
  }, []);

  return { toast, showToast };
}
