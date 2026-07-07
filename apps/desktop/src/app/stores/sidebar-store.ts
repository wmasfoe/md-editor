import { create } from "zustand";
import type { SidebarMode } from "../../types";

export interface SidebarStore {
  isSidebarVisible: boolean;
  sidebarMode: SidebarMode;
  setIsSidebarVisible: (value: boolean | ((prev: boolean) => boolean)) => void;
  setSidebarMode: (value: SidebarMode | ((prev: SidebarMode) => SidebarMode)) => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isSidebarVisible: typeof window !== "undefined" ? window.innerWidth >= 960 : true,
  sidebarMode: "files",
  setIsSidebarVisible: (value) =>
    set((state) => ({
      isSidebarVisible: typeof value === "function" ? value(state.isSidebarVisible) : value,
    })),
  setSidebarMode: (value) =>
    set((state) => ({
      sidebarMode: typeof value === "function" ? value(state.sidebarMode) : value,
    })),
}));
