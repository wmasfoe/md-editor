import { useState } from "react";
import { useTranslation } from "@md-editor/i18n";

export const SIDEBAR_DEFAULT_WIDTH = 272;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function clampSidebarPreviewWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(0, width));
}

export interface SidebarResizerProps {
  readonly width: number;
  readonly onCommitWidth: (width: number) => void;
  readonly onCollapse: () => void;
}

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

        const onPointerMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          onPreview(moveEvent.clientX);
        };

        const onPointerUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) return;
          try {
            target.releasePointerCapture(pointerId);
          } catch {
            // Ignore capture release error
          }
          target.removeEventListener("pointermove", onPointerMove);
          target.removeEventListener("pointerup", onPointerUp);
          target.removeEventListener("pointercancel", onPointerCancel);
          onCommit(upEvent.clientX);
        };

        const onPointerCancel = (cancelEvent: PointerEvent) => {
          if (cancelEvent.pointerId !== pointerId) return;
          try {
            target.releasePointerCapture(pointerId);
          } catch {
            // Ignore capture release error
          }
          target.removeEventListener("pointermove", onPointerMove);
          target.removeEventListener("pointerup", onPointerUp);
          target.removeEventListener("pointercancel", onPointerCancel);
          onCancel();
        };

        target.addEventListener("pointermove", onPointerMove);
        target.addEventListener("pointerup", onPointerUp);
        target.addEventListener("pointercancel", onPointerCancel);
      }}
    >
      <div className="h-full w-[2px] bg-transparent transition-colors duration-150 group-hover:bg-[var(--theme-primary)] group-active:bg-[var(--theme-primary)]" />
    </div>
  );
}
