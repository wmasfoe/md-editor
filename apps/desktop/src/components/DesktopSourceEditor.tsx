import { lazy, Suspense } from "react";
import { useDocumentSnapshot } from "../app/document-store";
import { useEditorScrollStore } from "../app/stores/editor-scroll-store";
import { useOutlineStore } from "../app/stores/outline-store";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { GLOBAL_LOADING_TITLE } from "../app/loading-state";

const SourceEditor = lazy(() =>
  import("@md-editor/editor-ui/source-editor").then((m) => ({ default: m.SourceEditor }))
);

function EditorLoadingState({ title }: { readonly title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--theme-control-subtle)]">
      {title}
    </div>
  );
}

export function DesktopSourceEditor() {
  const snapshot = useDocumentSnapshot();
  const { tocTarget, updateActiveOutlineForLine } = useOutlineStore();
  const { modeScrollTarget, updateModeScrollRatio, completeModeScrollTarget } = useEditorScrollStore();
  const { commitMarkdown } = useDocumentUiStore();

  return (
    <Suspense fallback={<EditorLoadingState title={GLOBAL_LOADING_TITLE} />}>
      <SourceEditor
        snapshot={snapshot}
        target={tocTarget}
        scrollTarget={modeScrollTarget?.mode === "source" ? modeScrollTarget.target : null}
        onChange={commitMarkdown}
        onScrollRatioChange={updateModeScrollRatio}
        onScrollTargetApplied={completeModeScrollTarget}
        onVisibleLineChange={updateActiveOutlineForLine}
      />
    </Suspense>
  );
}
