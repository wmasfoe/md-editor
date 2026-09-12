import type React from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@md-editor/i18n";
import { cx } from "../lib/cx";

export interface CollapsedSidebarRevealProps {
  readonly onReveal: () => void;
}

/**
 * 侧边栏收起时在屏幕左边缘显示的悬浮唤起按钮。
 */
export function CollapsedSidebarReveal({ onReveal }: CollapsedSidebarRevealProps) {
  const { t } = useTranslation();

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    onReveal();
  };

  return (
    <div className={cx("group pointer-events-none absolute bottom-0 left-0 top-0 z-[17] w-4")}>
      <button
        type="button"
        className="pointer-events-auto absolute left-0 top-1/2 grid h-14 w-4 -translate-y-1/2 touch-none place-items-center border-0 bg-transparent p-0 text-[var(--theme-control-text)] opacity-0 transition-[opacity,transform,color] duration-150 ease-out hover:text-[var(--theme-title)] hover:opacity-90 active:scale-95 group-hover:opacity-60 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.25]"
        aria-label={t("sidebar.showSidebar")}
        title={t("sidebar.showSidebar")}
        onPointerDown={handlePointerDown}
        onClick={onReveal}
      >
        <ChevronRightIcon aria-hidden="true" />
      </button>
    </div>
  );
}
