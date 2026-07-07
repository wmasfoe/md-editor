import { lazy, Suspense, useCallback, type ComponentType } from "react";
import { useDocumentSnapshot } from "../app/document-store";
import { useAppSettings } from "../app/settings-context";
import { useEditorScrollStore } from "../app/stores/editor-scroll-store";
import { useOutlineStore } from "../app/stores/outline-store";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import type {
  MdxComponentMenuRenderProps,
  MilkdownEditorCommandHandlers,
  MilkdownEditorProps
} from "@md-editor/editor-ui";
import { getAiCompletionReadiness } from "@md-editor/editor-core/ai";
import { useEditorCommandsStore } from "../app/stores/editor-commands-store";
import { runtime } from "../app/runtime/editor-runtime";
import { requestDesktopAiContinuation } from "../app/ai/ai-continuation-adapter";
import { MdxComponentMenu } from "./MdxComponentMenu";
import { GLOBAL_LOADING_TITLE } from "../app/loading-state";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";

const MilkdownEditor = lazy(async () => {
  const module = await import("@md-editor/editor-ui/milkdown-editor");
  return {
    default: module.MilkdownEditor as ComponentType<MilkdownEditorProps<MdxComponentPlugin>>
  };
});

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
  const getMdxComponentPlugins = useCallback(() => runtime.mdxComponents.listInsertable(), []);
  const registerEditorCommands = useCallback((commands: MilkdownEditorCommandHandlers) => {
    useEditorCommandsStore.setState({
      openMdxComponentMenu: commands.openMdxComponentMenu,
      continueAiWriting: commands.continueAiWriting
    });
  }, []);
  const renderMdxComponentMenu = useCallback(
    ({ plugins, onInsert, onClose }: MdxComponentMenuRenderProps<MdxComponentPlugin>) => (
      <MdxComponentMenu
        plugins={plugins}
        onInsert={onInsert}
        onClose={onClose}
      />
    ),
    []
  );

  return (
    <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
      <MilkdownEditor
        key={documentKey}
        snapshot={snapshot}
        outline={outline}
        target={tocTarget}
        mdxAi={{
          aiSettings: settings.ai,
          getEditorMode,
          showToast,
          getMdxComponentPlugins,
          getAiCompletionReadiness,
          requestAiCompletion: requestDesktopAiContinuation
        }}
        onEditorCommandsChange={registerEditorCommands}
        renderMdxComponentMenu={renderMdxComponentMenu}
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
  );
}
