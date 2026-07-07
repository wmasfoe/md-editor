import { create } from "zustand";
import type { RunFileAction } from "../controller/useFileActionController";

export interface FileActionStore {
  pendingAction: string | null;
  runFileAction: RunFileAction;
  showFileActionError: (error: unknown) => void;
}

export const useFileActionStore = create<FileActionStore>(() => ({
  pendingAction: null,
  runFileAction: async () => {},
  showFileActionError: () => {},
}));
