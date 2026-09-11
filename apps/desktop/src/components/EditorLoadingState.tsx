import { cx } from "../lib/cx";

export interface EditorLoadingStateProps {
  readonly title: string;
  readonly description?: string;
  readonly ariaLabel?: string;
  /** 是否作为覆盖在正文上方的绝对定位半透明遮罩 */
  readonly isOverlay?: boolean;
}

/**
 * 编辑器异步操作状态指示器（如文件读取、重命名、保存 settlement 等）。
 *
 * 特性：
 * 1. 采用 oklab 颜色混合与高斯模糊背景（backdrop-blur-[2px]）；
 * 2. 具备无障碍语义（role="status" 与 aria-live="polite"）。
 */
export function EditorLoadingState({
  title,
  description,
  ariaLabel,
  isOverlay = false,
}: EditorLoadingStateProps) {
  return (
    <div
      className={cx(
        "pointer-events-none flex items-center justify-center bg-[color-mix(in_oklab,var(--theme-surface)_72%,transparent)] backdrop-blur-[2px]",
        isOverlay ? "absolute inset-0 z-10" : "min-h-0 flex-1",
      )}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? title}
    >
      <div className="flex min-w-[180px] max-w-[240px] flex-col items-center gap-3 rounded-[8px] border border-[var(--theme-border)] bg-[color-mix(in_oklab,var(--theme-surface)_94%,white)] px-5 py-4 text-center shadow-[var(--theme-shadow)]">
        <span
          className="block size-5 animate-spin rounded-full border-2 border-[var(--theme-border-strong)] border-t-[var(--theme-primary)]"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="m-0 text-[13px] font-medium leading-5 text-[var(--theme-title)]">{title}</p>
          {description ? (
            <p className="m-0 text-[12px] leading-5 text-[var(--theme-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
