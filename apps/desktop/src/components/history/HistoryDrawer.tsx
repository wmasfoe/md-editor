/**
 * @file HistoryDrawer.tsx
 * @description
 * 抽屉式文档历史版本快照时间轴与受控回滚面板。
 */

import React, { useEffect, useState } from "react";
import type { DocumentHistoryEntry } from "@md-editor/file-system";
import { historyStore, revertToHistorySnapshot } from "../../app/controller/session-controller.ts";

export interface HistoryDrawerProps {
  readonly open: boolean;
  readonly filePath: string | null;
  readonly onClose: () => void;
  readonly onShowToast?: (message: string) => void;
}

export function HistoryDrawer({ open, filePath, onClose, onShowToast }: HistoryDrawerProps) {
  const [snapshots, setSnapshots] = useState<readonly DocumentHistoryEntry[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !filePath) {
      setSnapshots([]);
      setSelectedSnapshotId(null);
      setPreviewContent(null);
      return;
    }

    setIsLoading(true);
    historyStore
      .listSnapshots(filePath)
      .then((list) => {
        setSnapshots(list.toReversed()); // 最新在最前
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [open, filePath]);

  const handleSelectSnapshot = async (snapshotId: string) => {
    if (!filePath) return;
    setSelectedSnapshotId(snapshotId);
    const content = await historyStore.loadSnapshotContent(filePath, snapshotId);
    setPreviewContent(content);
  };

  const handleRevert = async (snapshotId: string) => {
    if (!filePath) return;
    const ok = await revertToHistorySnapshot(filePath, snapshotId);
    if (ok) {
      onShowToast?.("已恢复至历史版本（按 Cmd+Z 可随时撤销反悔）");
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="文档历史快照"
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-xs transition-opacity"
    >
      <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-2xl animate-in slide-in-from-right duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-[var(--theme-foreground)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <h2 className="text-sm font-semibold text-[var(--theme-foreground)]">文档版本历史</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-foreground)] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 快照列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-[var(--theme-muted)]">
              加载历史快照中...
            </div>
          ) : snapshots.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--theme-muted)]">
              暂无历史快照版本。
              <br />
              （保存文档时将自动生成快照）
            </div>
          ) : (
            snapshots.map((item) => {
              const date = new Date(item.timestamp);
              const isSelected = selectedSnapshotId === item.id;
              const triggerLabel =
                item.trigger === "manual-save"
                  ? "手动保存"
                  : item.trigger === "pre-restore"
                    ? "回滚前快照"
                    : "自动快照";

              return (
                <div
                  key={item.id}
                  onClick={() => void handleSelectSnapshot(item.id)}
                  className={`group relative flex flex-col gap-1 rounded-lg border p-3 text-xs cursor-pointer transition-all ${
                    isSelected
                      ? "border-blue-500/50 bg-blue-500/10 shadow-sm"
                      : "border-[var(--theme-border)] bg-[var(--theme-surface-soft)] hover:border-[var(--theme-border-strong)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--theme-foreground)]">
                      {date.toLocaleDateString()}{" "}
                      {date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span className="rounded bg-[var(--theme-surface)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
                      {triggerLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[var(--theme-muted)]">
                    <span>
                      {item.charCount.toLocaleString()} 字符 · {item.lineCount} 行
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRevert(item.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 rounded bg-blue-600 hover:bg-blue-700 px-2 py-0.5 text-[10px] font-medium text-white transition-all"
                    >
                      恢复此版本
                    </button>
                  </div>

                  {isSelected && previewContent !== null ? (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2 font-mono text-[10px] text-[var(--theme-muted)] whitespace-pre-wrap">
                      {previewContent.slice(0, 1000)}
                      {previewContent.length > 1000 ? "\n\n... (后续内容省略)" : ""}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
