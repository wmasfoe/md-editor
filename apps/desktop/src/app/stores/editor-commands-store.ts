import { create } from "zustand";

export interface EditorCommandsStore {
  openMdxComponentMenu: () => void;
  continueAiWriting: () => Promise<void>;
}

export const useEditorCommandsStore = create<EditorCommandsStore>(() => ({
  openMdxComponentMenu: () => {},
  continueAiWriting: async () => {},
}));
