import { cx } from "../../lib/cx";

export interface ContextMenuItemProps {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
  readonly onClick: () => void;
}

export function ContextMenuItem({
  children,
  danger = false,
  onClick
}: ContextMenuItemProps) {
  return (
    <button
      type="button"
      className={cx(
        "block min-h-7 w-full rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[13px] leading-[1.35] text-(--theme-control-text) transition-colors hover:bg-(--theme-control-hover) hover:text-(--theme-title)",
        danger && "text-(--theme-danger-text)"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
