import { create } from "zustand";
import type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-ui";

export interface ConfirmationStore {
  confirmation: ConfirmationState | null;
  requestConfirmation: (state: ConfirmationState) => Promise<ConfirmationChoice>;
  resolveConfirmation: (choice: ConfirmationChoice) => void;
  hasPendingConfirmation: () => boolean;
}

export const useConfirmationStore = create<ConfirmationStore>(() => ({
  confirmation: null,
  requestConfirmation: () => Promise.resolve("cancel" as ConfirmationChoice),
  resolveConfirmation: () => {},
  hasPendingConfirmation: () => false,
}));
