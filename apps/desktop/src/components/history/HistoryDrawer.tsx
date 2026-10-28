/**
 * @file HistoryDrawer.tsx
 * @description
 * 极简、macOS 原生风格的文档历史版本检视与恢复工作台（Centered Sheet Modal）。
 * 遵循极简主义（Simplicity is architecture），去除冗余图例与厚重卡片，提供纯粹的时间轴与 Visual Diff。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentHistoryEntry } from "@md-editor/file-system";
import { runtime } from "../../app/runtime/editor-runtime";
import { historyStore, revertToHistorySnapshot } from "../../app/controller/session-controller";
import { computeLineDiff, type DiffResult } from "./line-diff";
import { cx } from "../../lib/cx";

export interface HistoryDrawerProps {
  readonly open: boolean;
  readonly filePath: string | null;
  readonly onClose: () => void;
  readonly onShowToast?: (message: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "2-digit",
    day: "2-digit",
  });
}

export function HistoryDrawer({ open, filePath, onClose, onShowToast }: HistoryDrawerProps) {
  const [snapshots, setSnapshots] = useState<readonly DocumentHistoryEntry[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"diff" | "preview">("diff");
  const [isCopied, setIsCopied] = useState(false);

  // 小屏幕模式下的 Tab 切换 (列表 vs 详情)
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("detail");

  // 加载快照列表与当前编辑器内容
  useEffect(() => {
    if (!open || !filePath) {
      setSnapshots([]);
      setSelectedSnapshotId(null);
      setPreviewContent(null);
      setCurrentContent("");
      return;
    }

    try {
      const activeSnapshot = runtime.document.getSnapshot();
      setCurrentContent(activeSnapshot.markdown);
    } catch {
      setCurrentContent("");
    }

    setIsLoading(true);
    historyStore
      .listSnapshots(filePath)
      .then(async (list) => {
        const sorted = list.toReversed(); // 最新在前
        setSnapshots(sorted);

        if (sorted.length > 0) {
          const first = sorted[0];
          setSelectedSnapshotId(first.id);
          const content = await historyStore.loadSnapshotContent(filePath, first.id);
          setPreviewContent(content);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [open, filePath]);

  const handleSelectSnapshot = useCallback(
    async (snapshotId: string) => {
      if (!filePath) return;
      setSelectedSnapshotId(snapshotId);
      const content = await historyStore.loadSnapshotContent(filePath, snapshotId);
      setPreviewContent(content);
      setMobileTab("detail");
    },
    [filePath],
  );

  const handleRevert = async (snapshotId: string) => {
    if (!filePath) return;
    const ok = await revertToHistorySnapshot(filePath, snapshotId);
    if (ok) {
      onShowToast?.("已恢复至该版本（按 Cmd+Z 可撤销）");
      onClose();
    }
  };

  const handleCopy = async () => {
    if (previewContent === null) return;
    try {
      await navigator.clipboard.writeText(previewContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1600);
      onShowToast?.("已复制快照全文");
    } catch {
      onShowToast?.("复制失败");
    }
  };

  // 键盘快捷键支持：Escape 关闭，ArrowUp / ArrowDown 切换版本快照
  useEffect(() => {
    if (!open || snapshots.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = snapshots.findIndex((s) => s.id === selectedSnapshotId);
        if (currentIndex < snapshots.length - 1) {
          void handleSelectSnapshot(snapshots[currentIndex + 1].id);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const currentIndex = snapshots.findIndex((s) => s.id === selectedSnapshotId);
        if (currentIndex > 0) {
          void handleSelectSnapshot(snapshots[currentIndex - 1].id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, snapshots, selectedSnapshotId, handleSelectSnapshot]);

  // 计算行级 Visual Diff
  const diffResult: DiffResult = useMemo(() => {
    if (previewContent === null) {
      return { lines: [], additions: 0, deletions: 0, charDelta: 0, hasChanges: false };
    }
    return computeLineDiff(currentContent, previewContent);
  }, [currentContent, previewContent]);

  const activeSnapshot = snapshots.find((s) => s.id === selectedSnapshotId);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="版本历史"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 bg-black/40 backdrop-blur-[4px] animate-in fade-in duration-150 select-none"
    >
      {/* 遮罩背景点击退出 */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* 居中悬浮极简工作台面板 */}
      <div className="relative z-10 flex flex-col w-[min(920px,calc(100vw-32px))] h-[min(620px,calc(100vh-48px))] rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-2xl overflow-hidden animate-in zoom-in-[0.98] duration-150">
        {/* 顶部统一极简工具栏 */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 sm:px-4 gap-2 select-none">
          {/* 左侧：标题与计数 */}
          <div className="flex items-center gap-2 shrink-0">
            {mobileTab === "detail" && (
              <button
                type="button"
                onClick={() => setMobileTab("list")}
                className="sm:hidden flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-control-hover)]"
              >
                ← 列表
              </button>
            )}
            <h2 className="text-[13px] font-semibold text-[var(--theme-title)]">版本历史</h2>
            <span className="rounded-full bg-[var(--theme-control-hover)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--theme-muted)]">
              {snapshots.length}
            </span>
          </div>

          {/* 中间：选中快照摘要信息 */}
          {activeSnapshot && (
            <div className="hidden sm:flex items-center gap-2 min-w-0">
              <span className="text-[12px] text-[var(--theme-title)] font-mono truncate">
                {new Date(activeSnapshot.timestamp).toLocaleString([], {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {diffResult.hasChanges ? (
                <div className="flex items-center gap-1 font-mono text-[10.5px]">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    +{diffResult.additions}
                  </span>
                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                    -{diffResult.deletions}
                  </span>
                </div>
              ) : (
                <span className="rounded bg-[var(--theme-control-hover)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)] font-medium">
                  与当前一致
                </span>
              )}
            </div>
          )}

          {/* 右侧：分段切换、动作与关闭 */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 极简分段控件 */}
            <div className="inline-flex rounded-lg bg-[var(--theme-control-active)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className={cx(
                  "rounded-md px-2.5 py-1 text-[11px] transition-all",
                  viewMode === "diff"
                    ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-medium shadow-xs"
                    : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]",
                )}
              >
                对比
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={cx(
                  "rounded-md px-2.5 py-1 text-[11px] transition-all",
                  viewMode === "preview"
                    ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-medium shadow-xs"
                    : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]",
                )}
              >
                预览
              </button>
            </div>

            {activeSnapshot && (
              <>
                {/* 复制全文 */}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="hidden md:inline-flex items-center gap-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] transition-colors"
                >
                  {isCopied ? "已复制" : "复制"}
                </button>

                {/* 恢复版本 */}
                <button
                  type="button"
                  onClick={() => void handleRevert(activeSnapshot.id)}
                  className="inline-flex items-center rounded-lg bg-[var(--theme-primary)] hover:opacity-90 active:scale-[0.98] px-3 py-1 text-[11.5px] font-medium text-white transition-all shadow-xs"
                >
                  恢复此版本
                </button>
              </>
            )}

            {/* 关闭 */}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--theme-muted)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] transition-colors"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {/* 双栏主体 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左栏：快照时间轴列表 */}
          <aside
            className={cx(
              "flex flex-col border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] overflow-y-auto select-none",
              mobileTab === "list" ? "w-full" : "hidden sm:flex sm:w-64 md:w-72 shrink-0",
            )}
          >
            {isLoading ? (
              <div className="py-16 text-center text-xs text-[var(--theme-muted)]">加载中...</div>
            ) : snapshots.length === 0 ? (
              <div className="py-16 text-center text-xs text-[var(--theme-muted)] leading-relaxed">
                暂无历史版本记录
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {snapshots.map((item) => {
                  const isSelected = selectedSnapshotId === item.id;
                  const date = new Date(item.timestamp);
                  const triggerLabel =
                    item.trigger === "manual-save"
                      ? "保存"
                      : item.trigger === "pre-restore"
                        ? "回滚"
                        : "自动";

                  return (
                    <div
                      key={item.id}
                      onClick={() => void handleSelectSnapshot(item.id)}
                      className={cx(
                        "group flex flex-col gap-1 rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors select-none",
                        isSelected
                          ? "bg-[var(--theme-control-active)] text-[var(--theme-title)] font-medium"
                          : "hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)]",
                      )}
                    >
                      {/* 首行：相对时间与轻量标签 */}
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-semibold text-[var(--theme-title)]">
                          {formatRelativeTime(item.timestamp)}
                        </span>
                        <span className="text-[10px] text-[var(--theme-muted)] font-normal rounded px-1.5 py-0.2 bg-[var(--theme-surface)]/70 border border-[var(--theme-border)]/40">
                          {triggerLabel}
                        </span>
                      </div>

                      {/* 次行：精准时间与体量 */}
                      <div className="flex items-center justify-between text-[11px] text-[var(--theme-muted)] font-mono">
                        <span>
                          {date.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span>{item.charCount.toLocaleString()} 字</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          {/* 右栏：Visual Diff 或 源码预览 */}
          <main
            className={cx(
              "flex-1 flex flex-col min-w-0 bg-[var(--theme-surface)] overflow-hidden",
              mobileTab === "list" ? "hidden sm:flex" : "flex",
            )}
          >
            {previewContent === null ? (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--theme-muted)]">
                请在左侧选择版本快照
              </div>
            ) : viewMode === "diff" ? (
              <div className="flex-1 overflow-auto font-mono text-[11.5px] leading-relaxed">
                {!diffResult.hasChanges ? (
                  <div className="h-full flex flex-col items-center justify-center gap-1.5 p-8 text-center text-[var(--theme-muted)]">
                    <svg
                      className="h-6 w-6 text-emerald-500/70"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-[13px] font-medium text-[var(--theme-title)]">
                      内容完全一致
                    </span>
                    <span className="text-[11.5px] text-[var(--theme-muted)]">
                      该快照与当前编辑器正文相同，无需恢复
                    </span>
                  </div>
                ) : (
                  <div className="min-w-full inline-block py-1">
                    {diffResult.lines.map((line, idx) => {
                      const isAdded = line.type === "added";
                      const isRemoved = line.type === "removed";

                      return (
                        <div
                          key={`diff-${idx}-${line.type}`}
                          className={cx(
                            "flex min-w-full hover:brightness-95 dark:hover:brightness-110",
                            isAdded
                              ? "bg-emerald-500/[0.08] text-emerald-950 dark:text-emerald-200"
                              : isRemoved
                                ? "bg-rose-500/[0.08] text-rose-950 dark:text-rose-200"
                                : "text-[var(--theme-text)]",
                          )}
                        >
                          {/* 行号 Gutter */}
                          <span className="w-10 shrink-0 select-none px-2 text-right text-[10px] text-[var(--theme-control-subtle)] opacity-60">
                            {line.currentLineNumber ?? ""}
                          </span>
                          <span className="w-10 shrink-0 select-none px-2 text-right text-[10px] text-[var(--theme-control-subtle)] opacity-60 border-r border-[var(--theme-border)]/40">
                            {line.snapshotLineNumber ?? ""}
                          </span>
                          {/* 差异标号 + / - */}
                          <span
                            className={cx(
                              "w-5 shrink-0 select-none text-center font-bold",
                              isAdded
                                ? "text-emerald-600 dark:text-emerald-400"
                                : isRemoved
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-transparent",
                            )}
                          >
                            {isAdded ? "+" : isRemoved ? "-" : " "}
                          </span>
                          {/* 代码文本 */}
                          <span className="flex-1 px-1.5 whitespace-pre-wrap break-all select-text font-mono">
                            {line.text || " "}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* 全文源码预览模式 */
              <div className="flex-1 overflow-auto p-2 font-mono text-[11.5px] leading-relaxed">
                <div className="min-w-full inline-block">
                  {previewContent.split(/\r?\n/).map((lineText, idx) => (
                    <div
                      key={`preview-line-${idx}`}
                      className="flex hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                    >
                      <span className="w-12 shrink-0 select-none px-2 text-right text-[10px] text-[var(--theme-control-subtle)] opacity-60">
                        {idx + 1}
                      </span>
                      <span className="flex-1 px-2 whitespace-pre-wrap break-all text-[var(--theme-text)] select-text font-mono">
                        {lineText || " "}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
