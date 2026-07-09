import { create } from "zustand";

export interface ToastState {
  readonly id: number;
  readonly message: string;
}

export interface ToastStore {
  toast: ToastState | null;
  showToast: (message: string | null) => void;
}

// toast 用 id 强制同文案也能重新触发展示动画。
export const useToastStore = create<ToastStore>((set) => ({
  toast: null,
  showToast: (message) => {
    if (!message) {
      set({ toast: null });
      return;
    }

    set({ toast: { id: Date.now(), message } });
  },
}));
