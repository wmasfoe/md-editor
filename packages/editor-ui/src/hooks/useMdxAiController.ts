import { useCallback, useMemo, useRef, useState } from "react";
import type { AiCompletionContext, AiSettings, AiWritingSuggestion } from "@md-editor/ai";
import type { EditorMode } from "@md-editor/editor-core";

export interface MdxSnippetPlugin {
  readonly insert?: {
    readonly createSnippet: () => string | null | undefined;
  };
}

export interface UseMdxAiControllerOptions<TPlugin extends MdxSnippetPlugin> {
  readonly aiSettings: AiSettings;
  readonly getEditorMode: () => EditorMode;
  readonly showToast: (message: string | null) => void;
  readonly getMdxComponentPlugins: () => readonly TPlugin[];
  readonly getAiCompletionReadiness: (settings: AiSettings) => string | null;
  readonly requestAiCompletion: (
    settings: AiSettings,
    context: AiCompletionContext,
    request?: { readonly signal?: AbortSignal },
  ) => Promise<AiWritingSuggestion>;
}

export function useMdxAiController<TPlugin extends MdxSnippetPlugin>({
  aiSettings,
  getEditorMode,
  showToast,
  getMdxComponentPlugins,
  getAiCompletionReadiness,
  requestAiCompletion,
}: UseMdxAiControllerOptions<TPlugin>) {
  const [isMdxComponentMenuOpen, setIsMdxComponentMenuOpen] = useState(false);
  const [mdxInsertRequest, setMdxInsertRequest] = useState<{
    readonly id: number;
    readonly markdown: string;
  } | null>(null);
  const [aiSuggestionRequest, setAiSuggestionRequest] = useState<{ readonly id: number } | null>(
    null,
  );
  const [isAiSuggestionPending, setIsAiSuggestionPending] = useState(false);
  const mdxInsertRequestId = useRef(0);
  const aiSuggestionRequestId = useRef(0);
  const mdxComponentPlugins = useMemo(() => getMdxComponentPlugins(), [getMdxComponentPlugins]);
  const isAiCompletionReady = useMemo(
    () => getAiCompletionReadiness(aiSettings) === null,
    [aiSettings, getAiCompletionReadiness],
  );

  const openMdxComponentMenu = useCallback(() => {
    if (getEditorMode() !== "wysiwyg") {
      showToast("请先切换到所见即所得模式再插入 MDX 组件。");
      return;
    }
    if (mdxComponentPlugins.length === 0) {
      showToast("没有可插入的 MDX 组件。");
      return;
    }
    setIsMdxComponentMenuOpen(true);
  }, [getEditorMode, mdxComponentPlugins.length, showToast]);

  const closeMdxComponentMenu = useCallback(() => {
    setIsMdxComponentMenuOpen(false);
  }, []);

  const clearMdxInsertRequest = useCallback((id?: number) => {
    setMdxInsertRequest((current) => {
      if (!current) {
        return null;
      }
      return id === undefined || current.id === id ? null : current;
    });
  }, []);

  const clearAiSuggestionRequest = useCallback((id?: number) => {
    setAiSuggestionRequest((current) => {
      if (!current) {
        return null;
      }
      return id === undefined || current.id === id ? null : current;
    });
    setIsAiSuggestionPending(false);
  }, []);

  const insertMdxComponent = useCallback(
    (plugin: TPlugin) => {
      const snippet = plugin.insert?.createSnippet();
      if (!snippet) {
        showToast("该 MDX 组件没有可插入模板。");
        return;
      }

      // Milkdown 通过 id 识别一次性插入请求，避免相同 markdown 连续插入被 React 合并。
      setIsMdxComponentMenuOpen(false);
      setMdxInsertRequest({
        id: (mdxInsertRequestId.current += 1),
        markdown: snippet,
      });
    },
    [showToast],
  );

  const continueAiWriting = useCallback(async () => {
    showToast(null);

    if (getEditorMode() !== "wysiwyg") {
      return;
    }

    const readiness = getAiCompletionReadiness(aiSettings);
    if (readiness) {
      return;
    }

    setIsAiSuggestionPending(true);
    setAiSuggestionRequest({ id: (aiSuggestionRequestId.current += 1) });
  }, [aiSettings, getAiCompletionReadiness, getEditorMode, showToast]);

  const requestAiSuggestion = useCallback(
    async (context: AiCompletionContext, request?: { readonly signal?: AbortSignal }) => {
      return requestAiCompletion(aiSettings, context, { signal: request?.signal });
    },
    [aiSettings, requestAiCompletion],
  );

  const handleAiSuggestionError = useCallback(() => {
    setIsAiSuggestionPending(false);
  }, []);

  return {
    isMdxComponentMenuOpen,
    mdxInsertRequest,
    aiSuggestionRequest,
    isAiSuggestionPending,
    isAiCompletionReady,
    mdxComponentPlugins,
    openMdxComponentMenu,
    closeMdxComponentMenu,
    clearMdxInsertRequest,
    clearAiSuggestionRequest,
    insertMdxComponent,
    continueAiWriting,
    requestAiSuggestion,
    handleAiSuggestionError,
  };
}
