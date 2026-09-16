"use client";

import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface LiquidGlassSegmentedControlProps<T extends string> {
  items: T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (item: T) => React.ReactNode;
  getAriaLabel?: (item: T) => string;
  disabledItems?: T[];
  ariaLabel?: string;
  className?: string;
}

/**
 * 寻找距离目标位置最近的可用项索引
 */
function findNearestEnabledIndex<T extends string>(
  targetIdx: number,
  items: T[],
  disabledItems?: T[],
): number {
  if (!disabledItems || disabledItems.length === 0) {
    return Math.max(0, Math.min(items.length - 1, targetIdx));
  }

  if (!disabledItems.includes(items[targetIdx])) {
    return targetIdx;
  }

  let left = targetIdx - 1;
  let right = targetIdx + 1;
  while (left >= 0 || right < items.length) {
    if (left >= 0 && !disabledItems.includes(items[left])) {
      return left;
    }
    if (right < items.length && !disabledItems.includes(items[right])) {
      return right;
    }
    left--;
    right++;
  }

  return targetIdx;
}

/**
 * Apple 物理液态光学玻璃分段控制器 (Liquid Glass Segmented Control)
 *
 * 核心设计原则：
 * 1. 物理真实性：底层为通透晶莹的悬浮水滴药丸（Liquid Glass Pill），带顶部钻石镜面高光弧与多层柔和悬浮阴影；
 * 2. 保证字体绝对清晰：文字层独立居于光学滤镜之上，杜绝色散拉伸、杂色边缘与模糊锯齿；
 * 3. 丝滑阻尼物理滑动：采用 Apple fluid deceleration 缓动曲线与连续拖拽跟随；
 * 4. 原生支持项目置灰禁用（例如 iOS 待发布状态）：不可点击、键盘自动跳过、半透明置灰。
 */
export function LiquidGlassSegmentedControl<T extends string>({
  items,
  value,
  onChange,
  getLabel,
  getAriaLabel,
  disabledItems = [],
  ariaLabel,
  className = "",
}: LiquidGlassSegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndex = items.indexOf(value);
  const count = items.length;

  // 容器像素宽度
  const [, setTrackW] = useState(0);
  const trackWRef = useRef(0);

  // 连续位置状态（用于拖拽跟随）
  const [dragPos, setDragPos] = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const isPointerDownRef = useRef(false);
  const dragCtx = useRef<{ startX: number; hasMoved: boolean; targetIdxOnDown: number }>({
    startX: 0,
    hasMoved: false,
    targetIdxOnDown: -1,
  });

  // 测量容器实际尺寸
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        const w = Math.round(r.width);
        if (w !== trackWRef.current) {
          trackWRef.current = w;
          setTrackW(w);
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const transitionTo = useCallback(
    (targetIndex: number) => {
      const targetItem = items[targetIndex];
      if (!targetItem || disabledItems.includes(targetItem)) return;
      onChange(targetItem);
    },
    [items, disabledItems, onChange],
  );

  // 指针拖拽计算连续位置
  const applyPointerX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pad = 4;
      const slot = (rect.width - pad * 2) / count;
      const raw = (clientX - rect.left - pad - slot / 2) / slot;
      const pos = Math.max(0, Math.min(count - 1, raw));
      setDragPos(pos);
      return pos;
    },
    [count],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = containerRef.current;
    let clickedIdx = -1;
    if (el) {
      const rect = el.getBoundingClientRect();
      const pad = 4;
      const slot = (rect.width - pad * 2) / count;
      const raw = (e.clientX - rect.left - pad) / slot;
      clickedIdx = Math.max(0, Math.min(count - 1, Math.floor(raw)));
    }

    if (clickedIdx >= 0 && disabledItems.includes(items[clickedIdx])) {
      return;
    }

    dragCtx.current = { startX: e.clientX, hasMoved: false, targetIdxOnDown: clickedIdx };
    isPointerDownRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    if (!dragCtx.current.hasMoved && Math.abs(e.clientX - dragCtx.current.startX) > 4) {
      dragCtx.current.hasMoved = true;
      isDraggingRef.current = true;
    }
    if (dragCtx.current.hasMoved) {
      applyPointerX(e.clientX);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    if (dragCtx.current.hasMoved) {
      isDraggingRef.current = false;
      if (dragPos !== null) {
        const rawTarget = Math.round(dragPos);
        const enabledTarget = findNearestEnabledIndex(rawTarget, items, disabledItems);
        transitionTo(enabledTarget);
      }
      setDragPos(null);
    } else {
      const clickedIdx = dragCtx.current.targetIdxOnDown;
      if (
        clickedIdx >= 0 &&
        clickedIdx !== activeIndex &&
        !disabledItems.includes(items[clickedIdx])
      ) {
        transitionTo(clickedIdx);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();

    let targetIdx = activeIndex;
    if (e.key === "ArrowRight") {
      let next = activeIndex + 1;
      while (next < count && disabledItems.includes(items[next])) {
        next++;
      }
      if (next < count) targetIdx = next;
    } else if (e.key === "ArrowLeft") {
      let prev = activeIndex - 1;
      while (prev >= 0 && disabledItems.includes(items[prev])) {
        prev--;
      }
      if (prev >= 0) targetIdx = prev;
    } else if (e.key === "Home") {
      let first = 0;
      while (first < count && disabledItems.includes(items[first])) {
        first++;
      }
      if (first < count) targetIdx = first;
    } else if (e.key === "End") {
      let last = count - 1;
      while (last >= 0 && disabledItems.includes(items[last])) {
        last--;
      }
      if (last >= 0) targetIdx = last;
    }

    if (targetIdx !== activeIndex) {
      transitionTo(targetIdx);
      const nextItem = items[targetIdx];
      containerRef.current?.querySelector<HTMLButtonElement>(`[data-item="${nextItem}"]`)?.focus();
    }
  };

  const effectivePos = dragPos !== null ? dragPos : Math.max(0, activeIndex);
  const isDragging = dragPos !== null;

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`liquid-glass-track relative h-12 touch-pan-y select-none overflow-hidden rounded-full p-1 ${
        isDragging ? "cursor-grabbing" : "cursor-default"
      } ${className}`}
    >
      {/*
        Apple Liquid Glass 底层滑块透镜：
        纯净、高通透物理水滴卡片，居于文字下层，杜绝文字锯齿与色散拉伸
      */}
      {activeIndex >= 0 && (
        <div
          aria-hidden
          className={`liquid-glass-pill absolute top-1 bottom-1 z-0 rounded-full ${
            isDragging
              ? "transition-none shadow-[0_8px_24px_-2px_rgba(28,25,23,0.16),0_3px_8px_rgba(28,25,23,0.08)] scale-[1.02]"
              : "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          }`}
          style={{
            left: `calc(4px + ${effectivePos} * (100% - 8px) / ${count})`,
            width: `calc((100% - 8px) / ${count})`,
          }}
        >
          {/* 顶层钻石镜面反射微光弧 */}
          <span className="pointer-events-none absolute inset-x-3 top-0 h-[1px] bg-gradient-to-r from-transparent via-white to-transparent" />
        </div>
      )}

      {/* 
        中间高保真无畸变排版文字层
      */}
      <div
        className="relative z-10 grid h-full w-full pointer-events-none items-center"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {items.map((item, idx) => {
          const isActive = idx === activeIndex;
          const isDisabled = disabledItems.includes(item);

          return (
            <div
              key={item}
              className={`flex items-center justify-center text-[13px] transition-colors sm:text-sm ${
                isDisabled
                  ? "opacity-40 text-muted/60 cursor-not-allowed select-none"
                  : isActive
                    ? "font-semibold text-ink"
                    : "font-medium text-muted"
              }`}
            >
              {getLabel(item)}
            </div>
          );
        })}
      </div>

      {/* 
        顶层无障碍与交互透明按钮层
      */}
      <div
        className="absolute inset-1 z-20 grid"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {items.map((item, idx) => {
          const isActive = idx === activeIndex;
          const isDisabled = disabledItems.includes(item);

          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`segmented-tab-${item}`}
              data-item={item}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => !isDisabled && transitionTo(idx)}
              className={`inline-flex h-full w-full items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                isDisabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <span className="sr-only">
                {getAriaLabel
                  ? getAriaLabel(item)
                  : typeof getLabel(item) === "string"
                    ? (getLabel(item) as string)
                    : item}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
