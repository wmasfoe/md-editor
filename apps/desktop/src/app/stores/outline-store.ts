import { create } from "zustand";
import type { TocTarget } from "@md-editor/editor-ui";
import type { HeadingOutlineItem } from "@md-editor/markdown-fidelity";

export interface OutlineStore {
  outline: readonly HeadingOutlineItem[];
  activeOutlineId: string | null;
  tocTarget: TocTarget | null;
  setActiveOutlineId: (id: string | null) => void;
  jumpToTocItem: (target: Omit<TocTarget, "nonce">) => void;
  jumpToMarkdownFragment: (markdown: string, fragment: string | null) => void;
  updateActiveOutlineForLine: (line: number) => void;
}

export const useOutlineStore = create<OutlineStore>(() => ({
  outline: [],
  activeOutlineId: null,
  tocTarget: null,
  setActiveOutlineId: () => {},
  jumpToTocItem: () => {},
  jumpToMarkdownFragment: () => {},
  updateActiveOutlineForLine: () => {},
}));
