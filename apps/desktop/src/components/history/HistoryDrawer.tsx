/**
 * @file HistoryDrawer.tsx
 * @description
 * 抽屉式文档历史版本快照时间轴与双栏交互式 Visual Diff 恢复面板。
 * 遵循应用内置主题变量系统（--theme-primary, --theme-chrome, --theme-surface）
 * 以及 macOS 桌面级检查器自适应响应式规范。
 */

import React, { useEffect, useMemo, useState } from "react";
import type { DocumentHistoryEntry } from "@md-editor/file-system";
import { runtime } from "../../app/runtime/editor-runtime";
import { historyStore, revertToHistorySnapshot } from "../../app/controller/session-controller";
import { computeLineDiff, type DiffResult } from "./line-diff";
import { isMacPlatform } from "../../app/AppWindowChrome";
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

  const isMac = useMemo(() => isMacPlatform(), []);
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  const [compactTab, setCompactTab] = useState<"list" | "detail">("detail");

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isCompact = windowWidth < 880;
  const isUltraCompact = windowWidth < 680;

  // 打开抽屉时加载快照列表与当前编辑器内容
  useEffect(() => {
    if (!open || !filePath) {
      setSnapshots([]);
      setSelectedSnapshotId(null);
      setPreviewContent(null);
      setCurrentContent("");
      return;
    }

    // 获取当前活动编辑器的正文作为对比基准
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
        const sorted = list.toReversed(); // 最新快照在最前
        setSnapshots(sorted);

        // 默认自动选中最新的第一个历史快照
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

  const handleSelectSnapshot = async (snapshotId: string) => {
    if (!filePath) return;
    setSelectedSnapshotId(snapshotId);
    const content = await historyStore.loadSnapshotContent(filePath, snapshotId);
    setPreviewContent(content);
    if (isUltraCompact) {
      setCompactTab("detail");
    }
  };

  const handleRevert = async (snapshotId: string) => {
    if (!filePath) return;
    const ok = await revertToHistorySnapshot(filePath, snapshotId);
    if (ok) {
      onShowToast?.("已成功恢复至该版本（按 Cmd+Z 可随时撤回反悔）");
      onClose();
    }
  };

  const handleCopy = async () => {
    if (previewContent === null) return;
    try {
      await navigator.clipboard.writeText(previewContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1800);
      onShowToast?.("已复制快照内容至剪贴板");
    } catch {
      onShowToast?.("复制失败");
    }
  };

  // 响应 Escape 快捷键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 计算当前选中的快照与当前内容的 Visual Diff
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
      aria-label="文档历史版本快照"
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[6px] transition-opacity animate-in fade-in duration-200 select-none"
    >
      {/* 遮罩背景点击关闭 */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* 桌面级双栏 Visual Diff 检查器面板 */}
      <div
        className={cx(
          "relative z-10 flex h-full flex-row border-l border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-2xl animate-in slide-in-from-right duration-250 select-none overflow-hidden",
          isUltraCompact ? "w-full" : "w-[min(900px,calc(100vw-88px))]",
        )}
      >
        {/* 左栏：快照时间轴列表 */}
        <div
          className={cx(
            "flex flex-col border-r border-[var(--theme-border)] bg-[var(--theme-chrome)] select-none",
            isUltraCompact
              ? compactTab === "list"
                ? "w-full shrink-0"
                : "hidden"
              : isCompact
                ? "w-[240px] shrink-0"
                : "w-[270px] shrink-0",
          )}
        >
          {/* 左栏头部 */}
          <div
            className={cx(
              "flex h-12 items-center justify-between border-b border-[var(--theme-border)] px-3.5 select-none",
              isUltraCompact && isMac && "pl-[76px]",
            )}
          >
            <div className="flex items-center gap-2 select-none min-w-0">
              <svg
                className="h-4 w-4 shrink-0 text-[var(--theme-primary)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <h2 className="text-[13px] font-semibold text-[var(--theme-title)] select-none truncate">
                版本历史
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="rounded-full bg-[var(--theme-control-hover)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--theme-control-text)] select-none">
                {snapshots.length} 个版本
              </span>
              {isUltraCompact && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭历史版本抽屉"
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] select-none transition-colors"
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
              )}
            </div>
          </div>

          {/* 快照时间轴卡片列表 */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 select-none">
            {isLoading ? (
              <div className="py-12 text-center text-xs text-[var(--theme-muted)] select-none">
                正在加载快照历史...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-16 text-center text-xs text-[var(--theme-muted)] leading-relaxed select-none">
                暂无历史版本记录。
                <br />
                保存或自动记录时将生成快照。
              </div>
            ) : (
              snapshots.map((item) => {
                const isSelected = selectedSnapshotId === item.id;
                const date = new Date(item.timestamp);
                const relativeTime = formatRelativeTime(item.timestamp);
                const triggerBadge =
                  item.trigger === "manual-save"
                    ? {
                        label: "手动保存",
                        color: "bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]",
                      }
                    : item.trigger === "pre-restore"
                      ? {
                          label: "回滚快照",
                          color: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
                        }
                      : {
                          label: "自动快照",
                          color:
                            "bg-[var(--theme-control-active)] text-[var(--theme-control-text)]",
                        };

                return (
                  <div
                    key={item.id}
                    onClick={() => void handleSelectSnapshot(item.id)}
                    className={cx(
                      "group relative flex flex-col gap-1.5 rounded-[9px] border p-2.5 text-xs cursor-pointer select-none transition-all",
                      isSelected
                        ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] shadow-2xs ring-1 ring-[var(--theme-primary)]"
                        : "border-[var(--theme-border)] bg-[var(--theme-surface)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-control-hover)]",
                    )}
                  >
                    <div className="flex items-center justify-between select-none">
                      <span className="font-semibold text-[var(--theme-title)] text-[12.5px] select-none">
                        {relativeTime}
                      </span>
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium select-none",
                          triggerBadge.color,
                        )}
                      >
                        {triggerBadge.label}
                      </span>
                    </div>

                    <div className="text-[11px] text-[var(--theme-control-subtle)] font-mono select-none">
                      {date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      {" · "}
                      {date.toLocaleDateString([], { month: "2-digit", day: "2-digit" })}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[var(--theme-muted)] pt-1 border-t border-[var(--theme-border)]/40 select-none">
                      <span className="select-none">
                        {item.charCount.toLocaleString()} 字 · {item.lineCount} 行
                      </span>
                      {isSelected ? (
                        <span className="text-[10.5px] font-semibold text-[var(--theme-primary)] select-none">
                          正在检视 →
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右栏：Visual Diff 差异检视器与受控回滚 */}
        <div
          className={cx(
            "flex min-w-0 flex-1 flex-col bg-[var(--theme-surface)] select-none",
            isUltraCompact && compactTab === "list" && "hidden",
          )}
        >
          {/* 右栏顶部操作与元数据栏 */}
          <div
            className={cx(
              "flex h-12 items-center justify-between border-b border-[var(--theme-border)] px-3 select-none gap-2",
              isUltraCompact && isMac && "pl-[76px]",
            )}
          >
            {/* 左侧：返回按钮（超窄屏）与检视信息 */}
            <div className="flex items-center gap-2 min-w-0 select-none flex-1">
              {isUltraCompact && (
                <button
                  type="button"
                  onClick={() => setCompactTab("list")}
                  className="flex items-center gap-1 rounded-[5px] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-[11px] font-medium text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] select-none shrink-0"
                >
                  ← 列表
                </button>
              )}

              {activeSnapshot ? (
                <>
                  <div className="text-[12.5px] font-medium text-[var(--theme-title)] truncate select-none">
                    {isCompact
                      ? `快照 ${new Date(activeSnapshot.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                      : `快照检视：${new Date(activeSnapshot.timestamp).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
                  </div>
                  {/* 变更指标 Pills */}
                  {diffResult.hasChanges ? (
                    <div className="flex items-center gap-1 shrink-0 select-none">
                      <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400 font-mono select-none">
                        +{diffResult.additions}
                      </span>
                      <span className="rounded-md bg-rose-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700 dark:text-rose-400 font-mono select-none">
                        -{diffResult.deletions}
                      </span>
                    </div>
                  ) : (
                    <span className="rounded-md bg-[var(--theme-control-hover)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--theme-muted)] shrink-0 select-none">
                      一致
                    </span>
                  )}
                </>
              ) : (
                <div className="text-xs text-[var(--theme-muted)] select-none">请选择快照</div>
              )}
            </div>

            {/* 右侧：动作按钮与关闭 */}
            <div className="flex items-center gap-1.5 shrink-0 select-none">
              {activeSnapshot ? (
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] select-none transition-colors shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>{isCopied ? "已复制 ✓" : "复制快照"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRevert(activeSnapshot.id)}
                    className="flex items-center gap-1.5 rounded-[6px] bg-[var(--theme-primary-fill)] hover:bg-[color-mix(in_srgb,var(--theme-primary-fill)_88%,black)] active:scale-[0.98] px-3 py-1 text-[11.5px] font-semibold text-white shadow-xs select-none transition-all shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)]"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>恢复至此版本</span>
                  </button>
                </>
              ) : null}

              <button
                type="button"
                onClick={onClose}
                aria-label="关闭历史版本抽屉"
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] select-none transition-colors shrink-0"
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
          </div>

          {/* 模式切换器与图例引导条 */}
          <div className="flex min-h-[38px] items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-3 py-1 text-xs select-none gap-2">
            {/* 胶囊视图切换 */}
            <div className="inline-flex rounded-full bg-[var(--theme-control-active)] p-0.5 select-none shrink-0">
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className={cx(
                  "rounded-full px-2.5 py-0.5 text-[11px] transition-all select-none",
                  viewMode === "diff"
                    ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-semibold shadow-2xs"
                    : "text-[var(--theme-control-text)] hover:text-[var(--theme-title)] font-medium",
                )}
              >
                差异对比
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={cx(
                  "rounded-full px-2.5 py-0.5 text-[11px] transition-all select-none",
                  viewMode === "preview"
                    ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-semibold shadow-2xs"
                    : "text-[var(--theme-control-text)] hover:text-[var(--theme-title)] font-medium",
                )}
              >
                快照全文
              </button>
            </div>

            {/* 图例说明 */}
            {viewMode === "diff" ? (
              <div className="flex items-center gap-2.5 text-[11px] text-[var(--theme-muted)] select-none shrink-0">
                <span className="flex items-center gap-1 select-none">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>{isCompact ? "+ 找回" : "+ 快照找回"}</span>
                </span>
                <span className="flex items-center gap-1 select-none">
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                  <span>{isCompact ? "- 替换" : "- 本地修改"}</span>
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-[var(--theme-muted)] font-mono select-none shrink-0">
                {previewContent?.length ?? 0} 字 · {previewContent?.split(/\r?\n/).length ?? 0} 行
              </div>
            )}
          </div>

          {/* 核心内容区：Visual Diff 或 源码预览 */}
          <div className="flex-1 overflow-auto font-mono text-[11.5px] leading-[1.6]">
            {previewContent === null ? (
              <div className="py-24 text-center text-xs text-[var(--theme-muted)] select-none">
                请在左侧选择快照以查看差异与内容
              </div>
            ) : viewMode === "diff" ? (
              <div className="min-w-full inline-block">
                {!diffResult.hasChanges ? (
                  <div className="p-8 text-center text-xs text-[var(--theme-muted)] select-none">
                    该历史快照与当前编辑器内容完全一致，未产生行级修改。
                  </div>
                ) : (
                  diffResult.lines.map((line, idx) => {
                    const isAdded = line.type === "added";
                    const isRemoved = line.type === "removed";

                    return (
                      <div
                        key={`diff-${idx}-${line.type}`}
                        className={`flex min-w-full hover:brightness-95 dark:hover:brightness-110 ${
                          isAdded
                            ? "bg-emerald-500/[0.12] text-emerald-950 dark:text-emerald-200 border-l-[3px] border-emerald-500"
                            : isRemoved
                              ? "bg-rose-500/[0.12] text-rose-950 dark:text-rose-200 border-l-[3px] border-rose-500"
                              : "text-[var(--theme-text)] border-l-[3px] border-transparent"
                        }`}
                      >
                        {/* 当前行号 */}
                        <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-[10px] text-[var(--theme-control-subtle)] opacity-70">
                          {line.currentLineNumber ?? ""}
                        </span>
                        {/* 快照行号 */}
                        <span className="w-10 shrink-0 select-none px-2 py-0.5 text-right text-[10px] text-[var(--theme-control-subtle)] opacity-70 border-r border-[var(--theme-border)]/40">
                          {line.snapshotLineNumber ?? ""}
                        </span>
                        {/* 差异标号 + / - */}
                        <span
                          className={`w-5 shrink-0 select-none text-center font-bold ${
                            isAdded
                              ? "text-emerald-600 dark:text-emerald-400"
                              : isRemoved
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-transparent"
                          }`}
                        >
                          {isAdded ? "+" : isRemoved ? "-" : " "}
                        </span>
                        {/* 正文文本（允许用户按需选中复制） */}
                        <span className="flex-1 px-1 py-0.5 whitespace-pre-wrap break-all select-text font-mono">
                          {line.text || " "}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* 全文源码预览模式 */
              <div className="min-w-full inline-block p-2">
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
