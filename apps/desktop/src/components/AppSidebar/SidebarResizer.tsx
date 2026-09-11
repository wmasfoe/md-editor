import { useState } from "react";
import { useTranslation } from "@md-editor/i18n";

export const SIDEBAR_DEFAULT_WIDTH = 272;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;

/**
 * 将侧边栏目标宽度限制在合法区间 [220, 420] px 内。
 */
export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * 将拖拽中预览宽度限制在 [0, 420] px 内（允许拖至小于最小宽度以提示自动收起）。
 */
export function clampSidebarPreviewWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(0, width));
}

export interface SidebarResizerProps {
  /** 当前已固化的侧边栏宽度 */
  readonly width: number;
  /** 拖拽结束时提交的新宽度 */
  readonly onCommitWidth: (width: number) => void;
  /** 拖拽宽度小于最小宽度时触发收起 */
  readonly onCollapse: () => void;
}

/**
 * 侧边栏宽度调节控制器（含虚线预览与指针跟踪）。
 *
 * 性能考量：
 * 将拖拽时的 previewWidth 实时状态内聚在组件内部，pointermove 仅刷新 Resizer 自身的虚线，
 * 避免频繁触发外层主应用与编辑器的整体重绘。
 */
export function SidebarResizer({ width, onCommitWidth, onCollapse }: SidebarResizerProps) {
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);

  const previewOffset =
    previewWidth === null ? null : clampSidebarPreviewWidth(previewWidth) - width;

  const handleCommit = (targetWidth: number) => {
    setPreviewWidth(null);
    if (targetWidth < SIDEBAR_MIN_WIDTH) {
      onCollapse();
      return;
    }
    onCommitWidth(clampSidebarWidth(targetWidth));
  };

  const handleCancel = () => {
    setPreviewWidth(null);
  };

  return (
    <div className="z-20 hidden h-full w-0 shrink-0 min-[960px]:grid">
      {previewOffset !== null ? (
        <div
          className="pointer-events-none col-start-1 row-start-1 h-full w-0 border-l border-dashed border-[var(--theme-primary)]"
          style={{ transform: `translateX(${previewOffset}px)` }}
          aria-hidden="true"
        />
      ) : null}
      <SidebarResizeHandle
        width={width}
        onPreview={setPreviewWidth}
        onCommit={handleCommit}
        onCancel={handleCancel}
      />
    </div>
  );
}

interface SidebarResizeHandleProps {
  readonly width: number;
  readonly onPreview: (width: number) => void;
  readonly onCommit: (width: number) => void;
  readonly onCancel: () => void;
}

function SidebarResizeHandle({ width, onPreview, onCommit, onCancel }: SidebarResizeHandleProps) {
  const { t } = useTranslation();

  return (
    <div
      className="group col-start-1 row-start-1 grid h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none place-items-center"
      role="separator"
      aria-label={t("sidebar.resizeSidebarAria")}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      onPointerDown={(event) => {
        event.preventDefault();
        const pointerId = event.pointerId;
        const target = event.currentTarget;
        target.setPointerCapture(pointerId);
        onPreview(event.clientX);

        const handlePointerMove = (moveEvent: PointerEvent) => {
          onPreview(moveEvent.clientX);
        };

        const stopTracking = () => {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerCancel);
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
          stopTracking();
          onCommit(upEvent.clientX);
        };

        const handlePointerCancel = () => {
          stopTracking();
          onCancel();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);
      }}
    >
      <span
        className="pointer-events-none h-full w-px bg-transparent group-hover:bg-[var(--theme-primary)]"
        aria-hidden="true"
      />
    </div>
  );
}
