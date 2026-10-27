import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cx } from "../lib/cx";

export interface AppToast {
  readonly id: number;
  readonly message: string;
}

export function AppTitleBar({
  actions,
  title,
  hasWindowControlsInset = false,
  isDirty = false,
  isVisible,
  titleAlign = "start",
  titleIcon,
  className,
}: {
  readonly actions?: ReactNode;
  readonly title?: string;
  readonly hasWindowControlsInset?: boolean;
  readonly isDirty?: boolean;
  readonly isVisible: boolean;
  readonly titleAlign?: "start" | "center";
  readonly titleIcon?: "markdown";
  readonly className?: string;
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className={cx(
        "relative h-[34px] shrink-0 select-none border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] text-[13px] text-[var(--theme-title)] transition-colors duration-150",
        titleAlign === "center" ? "grid items-center" : "flex items-center pr-4",
        titleAlign === "center"
          ? hasWindowControlsInset
            ? "grid-cols-[76px_minmax(0,1fr)_76px]"
            : "grid-cols-[12px_minmax(0,1fr)_12px]"
          : hasWindowControlsInset
            ? "pl-[76px]"
            : "pl-3",
        className,
      )}
      onMouseDown={startTitleBarDrag}
    >
      {title ? (
        <span
          data-tauri-drag-region
          className={cx(
            "flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden font-medium leading-none tracking-tight",
            titleAlign === "center" && "col-start-2 justify-self-center",
          )}
        >
          {titleIcon === "markdown" ? <MarkdownTitleIcon /> : null}
          <span
            data-tauri-drag-region
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--theme-title)]"
          >
            {title}
            {isDirty ? "*" : ""}
          </span>
        </span>
      ) : null}
      {actions ? (
        <div
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function MarkdownTitleIcon() {
  return (
    <svg
      className="size-[16px] shrink-0 text-[var(--theme-primary)] opacity-85"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="20.5" height="12.5" rx="2" />
      <path d="M5 11V5l2.5 3L10 5v6" />
      <path d="M16 5v5.5" />
      <path d="m13.75 8.5 2.25 2.25 2.25-2.25" />
    </svg>
  );
}

export function startTitleBarDrag(event: MouseEvent<HTMLElement>): void {
  if (event.button !== 0 || event.detail > 1 || !isTauri()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void getCurrentWindow()
    .startDragging()
    .catch((error: unknown) => {
      console.warn("窗口拖拽启动失败", error);
    });
}

export function EditorToast({ toast }: { readonly toast: AppToast | null }) {
  const [activeToast, setActiveToast] = useState<AppToast | null>(toast);

  useEffect(() => {
    setActiveToast(toast);
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setActiveToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!activeToast) {
    return null;
  }

  // 根据通知文案语义推断视觉指示状态
  const isError = /失败|错误|未能|异常|未找到|未就绪/.test(activeToast.message);
  const isSuccess = !isError && /已|成功|就绪|完成/.test(activeToast.message);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3.5 z-50 flex justify-center px-4"
      role="region"
      aria-live="polite"
    >
      <div
        key={activeToast.id}
        onClick={() => setActiveToast(null)}
        className={cx(
          "pointer-events-auto inline-flex items-center gap-2 max-w-[min(540px,calc(100vw_-_32px))] select-none",
          "rounded-full px-4 py-2 text-[13px] font-medium leading-none",
          "bg-[var(--theme-surface,#ffffff)]/94 dark:bg-[var(--theme-surface,#1c1b1a)]/94",
          "text-[var(--theme-text,#24292f)] dark:text-[var(--theme-text,#e6edf3)]",
          "border border-[var(--theme-border,rgba(0,0,0,0.1))] dark:border-[var(--theme-border,rgba(255,255,255,0.14))]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]",
          "backdrop-blur-xl transition-all duration-200 cursor-pointer active:scale-98",
          "motion-safe:animate-[toast-in_180ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none",
        )}
        role="alert"
      >
        {isSuccess ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 6.5L4.8 8.8L9.5 3.5" />
            </svg>
          </span>
        ) : isError ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="4.5" />
              <path d="M6 4v2.5M6 8.5h.01" />
            </svg>
          </span>
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-primary,#0969da)]" />
        )}
        <span className="truncate">{activeToast.message}</span>
      </div>
    </div>
  );
}

export function isMacPlatform(): boolean {
  if (!isTauri()) {
    return true;
  }
  const platform = (navigator.platform || "").toLowerCase();
  const userAgent = (navigator.userAgent || "").toLowerCase();
  return platform.includes("mac") || userAgent.includes("mac");
}
