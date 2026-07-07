import { lazy, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useDocumentSnapshot } from "../app/document-store";
import { useAppSettings } from "../app/settings-context";
import { useEditorScrollStore } from "../app/stores/editor-scroll-store";
import { useOutlineStore } from "../app/stores/outline-store";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { useMdxAiController } from "../app/controller/useMdxAiController";
import { useEditorCommandsStore } from "../app/stores/editor-commands-store";
import { runtime } from "../app/runtime/editor-runtime";
import { MdxComponentMenu } from "./MdxComponentMenu";
import { GLOBAL_LOADING_TITLE } from "../app/loading-state";

const MilkdownEditor = lazy(() =>
  import("@md-editor/editor-ui/milkdown-editor").then((m) => ({ default: m.MilkdownEditor }))
);

import { Suspense } from "react";

function EditorLoadingState({ title }: { readonly title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--theme-control-subtle)]">
      {title}
    </div>
  );
}

interface DesktopMilkdownEditorProps {
  readonly showToast: (message: string | null) => void;
}

export function DesktopMilkdownEditor({ showToast }: DesktopMilkdownEditorProps) {
  const snapshot = useDocumentSnapshot();
  const { settings } = useAppSettings();
  const { outline, tocTarget, setActiveOutlineId } = useOutlineStore();
  const { modeScrollTarget, updateModeScrollRatio, completeModeScrollTarget } = useEditorScrollStore();
  const { documentKey, commitMarkdown, openWysiwygLink, resolveImageSrc } = useDocumentUiStore();

  const getEditorMode = useCallback(() => runtime.document.getSnapshot().mode, []);

  const {
    isMdxComponentMenuOpen,
    mdxInsertRequest,
    aiSuggestionRequest,
    isAiSuggestionPending,
    isAiCompletionReady,
    mdxComponentPlugins,
    closeMdxComponentMenu,
    clearMdxInsertRequest,
    clearAiSuggestionRequest,
    insertMdxComponent,
    requestAiSuggestion,
    handleAiSuggestionError,
    openMdxComponentMenu,
    continueAiWriting,
  } = useMdxAiController({ aiSettings: settings.ai, getEditorMode, showToast });

  // 把命令注册进全局 command store，供 dispatchCommand (快捷键/菜单) 调用
  useLayoutEffect(() => {
    useEditorCommandsStore.setState({ openMdxComponentMenu, continueAiWriting });
  }, [openMdxComponentMenu, continueAiWriting]);

  return (
    <>
      <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
        <MilkdownEditor
          key={documentKey}
          snapshot={snapshot}
          outline={outline}
          target={tocTarget}
          insertRequest={mdxInsertRequest}
          aiSuggestionRequest={aiSuggestionRequest}
          isAiSuggestionPending={isAiSuggestionPending}
          aiAutoSuggestionsEnabled={isAiCompletionReady}
          onInsertRequestHandled={clearMdxInsertRequest}
          onAiSuggestionRequest={requestAiSuggestion}
          onAiSuggestionRequestHandled={clearAiSuggestionRequest}
          onAiSuggestionError={handleAiSuggestionError}
          onChange={commitMarkdown}
          onOpenLink={openWysiwygLink}
          scrollTarget={modeScrollTarget?.mode === "wysiwyg" ? modeScrollTarget.target : null}
          onScrollRatioChange={updateModeScrollRatio}
          onScrollTargetApplied={completeModeScrollTarget}
          onActiveOutlineChange={setActiveOutlineId}
          resolveImageSrc={resolveImageSrc}
          showCodeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
          wysiwygFontSize={settings.editor.wysiwygFontSize}
        />
      </Suspense>
      {isMdxComponentMenuOpen ? (
        <MdxComponentMenu
          plugins={mdxComponentPlugins}
          onInsert={insertMdxComponent}
          onClose={closeMdxComponentMenu}
        />
      ) : null}
    </>
  );
}
