import { create } from "zustand";
import {
  formatActionError,
  shouldShowFileActionOverlay,
  type RunFileAction
} from "@md-editor/editor-ui";
import { useToastStore } from "./toast-store";

export interface FileActionStore {
  pendingAction: string | null;
  runFileAction: RunFileAction;
  showFileActionError: (error: unknown) => void;
}

// 文件操作反馈是 desktop 全局交互状态；调用方只提供动作本身，不再各自维护 overlay/toast。
export const useFileActionStore = create<FileActionStore>((set) => ({
  pendingAction: null,
  runFileAction: async (label, action, options) => {
    const showOverlay = shouldShowFileActionOverlay(options);
    if (showOverlay) {
      set({ pendingAction: label });
    }

    useToastStore.getState().showToast(null);
    try {
      await action();
    } catch (error) {
      useToastStore.getState().showToast(formatActionError(error, "文件操作失败。"));
    } finally {
      if (showOverlay) {
        set({ pendingAction: null });
      }
    }
  },
  showFileActionError: (error) => {
    useToastStore.getState().showToast(formatActionError(error, "文件操作失败。"));
  },
}));
