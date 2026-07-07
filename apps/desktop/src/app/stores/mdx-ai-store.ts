import { create } from "zustand";
import type { AiCompletionContext } from "@md-editor/editor-core";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";

export interface MdxAiStore {
  isMdxComponentMenuOpen: boolean;
  mdxInsertRequest: { readonly id: number; readonly markdown: string } | null;
  aiSuggestionRequest: { readonly id: number } | null;
  isAiSuggestionPending: boolean;
  isAiCompletionReady: boolean;
  mdxComponentPlugins: readonly MdxComponentPlugin[];
  openMdxComponentMenu: () => void;
  closeMdxComponentMenu: () => void;
  clearMdxInsertRequest: (id?: number) => void;
  clearAiSuggestionRequest: (id?: number) => void;
  insertMdxComponent: (plugin: MdxComponentPlugin) => void;
  continueAiWriting: () => Promise<void>;
  requestAiSuggestion: (
    context: AiCompletionContext,
    request?: { readonly signal?: AbortSignal }
  ) => ReturnType<typeof import("../ai/ai-completion").requestAiContinuation>;
  handleAiSuggestionError: () => void;
}

export const useMdxAiStore = create<MdxAiStore>(() => ({
  isMdxComponentMenuOpen: false,
  mdxInsertRequest: null,
  aiSuggestionRequest: null,
  isAiSuggestionPending: false,
  isAiCompletionReady: false,
  mdxComponentPlugins: [],
  openMdxComponentMenu: () => {},
  closeMdxComponentMenu: () => {},
  clearMdxInsertRequest: () => {},
  clearAiSuggestionRequest: () => {},
  insertMdxComponent: () => {},
  continueAiWriting: async () => {},
  requestAiSuggestion: async () => { throw new Error("not initialized"); },
  handleAiSuggestionError: () => {},
}));
