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
}: {
  readonly actions?: ReactNode;
  readonly title?: string;
  readonly hasWindowControlsInset?: boolean;
  readonly isDirty?: boolean;
  readonly isVisible: boolean;
  readonly titleAlign?: "start" | "center";
  readonly titleIcon?: "markdown";
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className={cx(
        "relative h-[34px] shrink-0 select-none bg-[var(--theme-chrome)] text-[13px] text-[var(--theme-muted)]",
        titleAlign === "center" ? "grid items-center" : "flex items-center pr-4",
        titleAlign === "center"
          ? hasWindowControlsInset
            ? "grid-cols-[76px_minmax(0,1fr)_76px]"
            : "grid-cols-[12px_minmax(0,1fr)_12px]"
          : hasWindowControlsInset
            ? "pl-[76px]"
            : "pl-3",
      )}
      onMouseDown={startTitleBarDrag}
    >
      {title ? (
        <span
          data-tauri-drag-region
          className={cx(
            "flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden font-medium leading-none",
            titleAlign === "center" && "col-start-2 justify-self-center",
          )}
        >
          {titleIcon === "markdown" ? <MarkdownTitleIcon /> : null}
          <span
            data-tauri-drag-region
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
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
      className="size-[17px] shrink-0 text-[var(--theme-control-subtle)]"
      viewBox="0 0 24 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    const timer = window.setTimeout(() => setIsVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast || !isVisible) {
    return null;
  }

  return (
    <div
      key={toast.id}
      className="pointer-events-none absolute left-1/2 top-4 z-20 max-w-[min(520px,calc(100%_-_32px))] -translate-x-1/2 rounded-[10px] border border-white/10 bg-[rgba(38,38,40,0.86)] px-3.5 py-2 text-center text-[13px] font-medium leading-[1.35] text-white shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-xl motion-safe:animate-[toast-in_160ms_ease-out] motion-reduce:animate-none"
      role="alert"
    >
      {toast.message}
    </div>
  );
}

export function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}
