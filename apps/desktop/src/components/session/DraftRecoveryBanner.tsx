/**
 * @file DraftRecoveryBanner.tsx
 * @description
 * 未保存本地草稿恢复横幅提示组件（遵循决策做法 2：重新打开时提示用户恢复）。
 */

import React, { useState } from "react";
import type { PendingDraftInfo } from "../../app/controller/session-controller.ts";

export interface DraftRecoveryBannerProps {
  readonly draftInfo: PendingDraftInfo | null;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}

export function DraftRecoveryBanner({ draftInfo, onRestore, onDiscard }: DraftRecoveryBannerProps) {
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  if (!draftInfo) {
    return null;
  }

  const formattedTime = new Date(draftInfo.lastModifiedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div
        role="alert"
        aria-label="检测到未保存的本地草稿"
        className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-[var(--theme-foreground)] backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-1"
      >
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 shrink-0 text-amber-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span>检测到该文档存在上次未保存的本地草稿（记录于 {formattedTime}）。</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsDiffOpen(true)}
            className="rounded px-2 py-1 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-foreground)] transition-colors"
          >
            查看草稿预览
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 transition-colors"
          >
            放弃草稿
          </button>
          <button
            type="button"
            onClick={onRestore}
            className="rounded bg-amber-600 hover:bg-amber-700 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors"
          >
            恢复草稿
          </button>
        </div>
      </div>

      {isDiffOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="草稿内容预览"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--theme-foreground)]">
                未保存草稿预览
              </h3>
              <button
                type="button"
                onClick={() => setIsDiffOpen(false)}
                className="text-[var(--theme-muted)] hover:text-[var(--theme-foreground)]"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs text-[var(--theme-foreground)] whitespace-pre-wrap bg-[var(--theme-surface-soft)]">
              {draftInfo.draftContent}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--theme-border)] px-4 py-3 bg-[var(--theme-surface)]">
              <button
                type="button"
                onClick={() => setIsDiffOpen(false)}
                className="rounded px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDiffOpen(false);
                  onRestore();
                }}
                className="rounded bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm"
              >
                恢复此草稿
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
