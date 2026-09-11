import type React from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@md-editor/i18n";
import { cx } from "../../lib/cx";

export interface CollapsedSidebarRevealProps {
  readonly hasTitleBar: boolean;
  readonly onReveal: () => void;
}

/**
 * 侧边栏收起时在屏幕左边缘显示的悬浮唤起按钮。
 *
 * 设计考量：
 * 1. 仅按钮本身具有命中区（pointer-events-auto），外部透明容器设为 pointer-events-none，
 *    避免透明热区遮挡编辑器 gutter 内部的行内工具栏；
 * 2. 当 macOS 自定义标题栏可见时，顶部增加 top-[34px] 偏移，避免覆盖窗口原生拖拽区域。
 */
export function CollapsedSidebarReveal({ hasTitleBar, onReveal }: CollapsedSidebarRevealProps) {
  const { t } = useTranslation();
  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    onReveal();
  };

  return (
    <div
      className={cx(
        // 仅按钮本身参与命中;透明唤起层不能挡住编辑器 gutter 内的 toolbar。
        "group pointer-events-none absolute bottom-0 left-0 z-[17] w-4",
        // 左缘窄按钮作为侧栏唤起点,避免透明热区覆盖 toolbar 和 macOS 标题栏拖拽区。
        hasTitleBar ? "top-[34px]" : "top-0",
      )}
    >
      <button
        type="button"
        className="pointer-events-auto absolute left-0 top-1/2 grid h-14 w-4 -translate-y-1/2 touch-none place-items-center border-0 bg-transparent p-0 text-[var(--theme-control-text)] opacity-0 transition-[opacity,transform,color] duration-150 ease-out hover:text-[var(--theme-title)] hover:opacity-90 active:scale-95 group-hover:opacity-60 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] motion-reduce:transition-none [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.25]"
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
