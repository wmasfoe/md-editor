import React from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { OutlinePanel, useEditorUiActions, useEditorUiState } from "@md-editor/editor-ui";

export interface WebOutlineDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function WebOutlineDrawer({ open, onClose }: WebOutlineDrawerProps) {
  const { outline, activeOutlineId } = useEditorUiState();
  const { jumpToTocItem } = useEditorUiActions();

  if (!open) return null;

  return (
    <aside
      className="fixed inset-y-12 right-0 z-30 flex w-72 flex-col border-l border-[var(--theme-border)] bg-[var(--theme-chrome)]/95 shadow-xl backdrop-blur-md transition-transform duration-200 animate-in slide-in-from-right"
      aria-label="大纲抽屉"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--theme-border)] px-3.5">
        <span className="text-xs font-semibold text-[var(--theme-title)]">文档大纲</span>
        <button
          type="button"
          className="rounded p-1 text-[var(--theme-muted)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)]"
          title="关闭大纲"
          onClick={onClose}
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1">
        <OutlinePanel
          outline={outline}
          activeId={activeOutlineId}
          onJump={(target) => {
            jumpToTocItem(target);
          }}
        />
      </div>
    </aside>
  );
}
