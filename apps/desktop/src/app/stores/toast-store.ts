import { create } from "zustand";

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastState {
  readonly id: number;
  readonly message: string;
  /** 可选的单个操作（例如“撤销”）；点击后立即关闭提示 */
  readonly action?: ToastAction;
}

export interface ToastStore {
  toast: ToastState | null;
  showToast: (message: string | null, action?: ToastAction) => void;
}

// toast 用 id 强制同文案也能重新触发展示动画。
export const useToastStore = create<ToastStore>((set) => ({
  toast: null,
  showToast: (message, action) => {
    if (!message) {
      set({ toast: null });
      return;
    }

    set({ toast: { id: Date.now(), message, ...(action ? { action } : {}) } });
  },
}));
