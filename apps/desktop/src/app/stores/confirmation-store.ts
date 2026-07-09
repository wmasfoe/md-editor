import { create } from "zustand";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-ui";

export interface ConfirmationStore {
  confirmation: ConfirmationState | null;
  requestConfirmation: (state: ConfirmationState) => Promise<ConfirmationChoice>;
  resolveConfirmation: (choice: ConfirmationChoice) => void;
  hasPendingConfirmation: () => boolean;
}

// Resolver 是一次性 continuation，不属于可订阅 UI 状态；store 只暴露当前弹窗数据。
let confirmationResolver: ((choice: ConfirmationChoice) => void) | null = null;

export const useConfirmationStore = create<ConfirmationStore>((set) => ({
  confirmation: null,
  requestConfirmation: (confirmation) => {
    return new Promise<ConfirmationChoice>((resolve) => {
      confirmationResolver = resolve;
      set({ confirmation });
    });
  },
  resolveConfirmation: (choice) => {
    const resolve = confirmationResolver;
    confirmationResolver = null;
    set({ confirmation: null });
    resolve?.(choice);
  },
  hasPendingConfirmation: () => confirmationResolver !== null,
}));
