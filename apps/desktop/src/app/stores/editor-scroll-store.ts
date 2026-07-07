import { create } from "zustand";
import type { PendingModeScrollTarget } from "../controller/mode-scroll-target";

export interface EditorScrollStore {
  modeScrollTarget: PendingModeScrollTarget | null;
  updateModeScrollRatio: (ratio: number) => void;
  completeModeScrollTarget: (nonce: number) => void;
}

export const useEditorScrollStore = create<EditorScrollStore>(() => ({
  modeScrollTarget: null,
  updateModeScrollRatio: () => {},
  completeModeScrollTarget: () => {},
}));
