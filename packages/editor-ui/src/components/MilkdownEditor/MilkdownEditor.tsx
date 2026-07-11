import { useLayoutEffect } from "react";
import { MilkdownProvider } from "@milkdown/react";
import {
  emptyEditorUiCommandSlots,
  getModeScrollTargetForMode,
  useEditorUiActions,
  useEditorUiState,
} from "../../hooks/useEditorUi";
import { useMdxAiController, type MdxSnippetPlugin } from "../../hooks/useMdxAiController";
import { MilkdownEditorPrimitive } from "./MilkdownEditorPrimitive";
import type { MilkdownEditorProps, MilkdownEditorPrimitiveProps } from "./types";

export function MilkdownEditor<TPlugin extends MdxSnippetPlugin = MdxSnippetPlugin>({
  mdxAi,
  onEditorCommandsChange,
  renderMdxComponentMenu,
  ...primitiveInput
}: MilkdownEditorProps<TPlugin>) {
  const editorUiState = useEditorUiState();
  const editorUiActions = useEditorUiActions();
  const { registerEditorCommands } = editorUiActions;
  const mdxController = useMdxAiController<TPlugin>(mdxAi);

  useLayoutEffect(() => {
    const commands = {
      openMdxComponentMenu: mdxController.openMdxComponentMenu,
      continueAiWriting: mdxController.continueAiWriting,
    };
    registerEditorCommands(commands);
    onEditorCommandsChange?.(commands);

    return () => {
      registerEditorCommands(emptyEditorUiCommandSlots);
      onEditorCommandsChange?.(emptyEditorUiCommandSlots);
    };
  }, [
    mdxController.continueAiWriting,
    mdxController.openMdxComponentMenu,
    onEditorCommandsChange,
    registerEditorCommands,
  ]);

  const primitiveProps: MilkdownEditorPrimitiveProps = {
    ...primitiveInput,
    insertRequest: mdxController.mdxInsertRequest,
    aiSuggestionRequest: mdxController.aiSuggestionRequest,
    isAiSuggestionPending: mdxController.isAiSuggestionPending,
    aiAutoSuggestionsEnabled: mdxController.isAiCompletionReady,
    onInsertRequestHandled: mdxController.clearMdxInsertRequest,
    onAiSuggestionRequest: mdxController.requestAiSuggestion,
    onAiSuggestionRequestHandled: mdxController.clearAiSuggestionRequest,
    onAiSuggestionError: mdxController.handleAiSuggestionError,
    outline: editorUiState.outline,
    target: editorUiState.tocTarget,
    scrollTarget: getModeScrollTargetForMode(editorUiState.modeScrollTarget, "wysiwyg"),
    onScrollRatioChange: editorUiActions.updateModeScrollRatio,
    onScrollTargetApplied: editorUiActions.completeModeScrollTarget,
    onActiveOutlineChange: editorUiActions.setActiveOutlineId,
    sourceDrafts: editorUiState.wysiwygMarkdownSourceDrafts,
    onSourceDraftsChange: editorUiActions.setWysiwygMarkdownSourceDrafts,
  };

  return (
    <>
      <MilkdownProvider key={editorUiState.documentKey}>
        <MilkdownEditorPrimitive {...primitiveProps} />
      </MilkdownProvider>
      {mdxController.isMdxComponentMenuOpen && renderMdxComponentMenu
        ? renderMdxComponentMenu({
            plugins: mdxController.mdxComponentPlugins,
            onInsert: mdxController.insertMdxComponent,
            onClose: mdxController.closeMdxComponentMenu,
          })
        : null}
    </>
  );
}
