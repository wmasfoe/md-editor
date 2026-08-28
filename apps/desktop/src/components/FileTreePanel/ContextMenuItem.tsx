import { cx } from "../../lib/cx";

export interface ContextMenuItemProps {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
  readonly onClick: () => void;
}

export function ContextMenuItem({ children, danger = false, onClick }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      className={cx(
        "flex min-h-7 w-full cursor-pointer select-none items-center rounded-[6px] border-0 bg-transparent px-2.5 py-1 text-left text-[13px] leading-[1.35] text-[var(--theme-control-text)] transition-colors duration-100 hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:bg-[var(--theme-control-hover)] focus-visible:text-[var(--theme-title)] focus-visible:outline-none",
        danger &&
          "text-[var(--theme-danger-text)] hover:bg-[var(--theme-danger-bg)] hover:text-[var(--theme-danger-text)]",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
