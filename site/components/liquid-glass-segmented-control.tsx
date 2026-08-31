"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Glass,
  animateGlassValue,
  cubicBezier,
  glassValue,
  type GlassMotionValue,
  type GlassOptics,
} from "@samasante/liquid-glass";

export interface LiquidGlassSegmentedControlProps<T extends string> {
  items: T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (item: T) => string;
  ariaLabel?: string;
  className?: string;
}

// Apple 弹性流体缓动曲线
const EASE = cubicBezier(0.16, 1, 0.3, 1);

export function LiquidGlassSegmentedControl<T extends string>({
  items,
  value,
  onChange,
  getLabel,
  ariaLabel,
  className = "",
}: LiquidGlassSegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndex = items.indexOf(value);
  const count = items.length;

  // 容器像素尺寸
  const [trackW, setTrackW] = useState(0);
  const [trackH, setTrackH] = useState(0);
  const trackWRef = useRef(0);
  const trackHRef = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  // 连续位置 [0, count-1]
  const positionRef = useRef<number>(activeIndex >= 0 ? activeIndex : 0);

  // glassValue motion value：命令式驱动透镜中心 center.x
  const centerX = useMemo<GlassMotionValue>(
    () => glassValue(activeIndex >= 0 ? (activeIndex + 0.5) / count : 0.5 / count),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const isPointerDownRef = useRef(false);
  const dragCtx = useRef<{ startX: number; hasMoved: boolean; targetIdxOnDown: number }>({
    startX: 0,
    hasMoved: false,
    targetIdxOnDown: -1,
  });

  // ResizeObserver：测量容器实际 px 尺寸
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w !== trackWRef.current || h !== trackHRef.current) {
          trackWRef.current = w;
          trackHRef.current = h;
          setTrackW(w);
          setTrackH(h);
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 滑动过渡动画：从当前位置滑到目标 index
  const transitionTo = useCallback(
    (targetIndex: number) => {
      const targetItem = items[targetIndex];
      if (!targetItem) return;
      onChange(targetItem);
      positionRef.current = targetIndex;
      const targetCenterX = (targetIndex + 0.5) / count;
      animateGlassValue(centerX, targetCenterX, {
        duration: 0.38,
        ease: EASE,
      });
    },
    [items, onChange, count, centerX],
  );

  // 外部 value 变化时平滑滑向新选项
  useEffect(() => {
    if (!isDraggingRef.current && !isPointerDownRef.current && activeIndex >= 0) {
      if (positionRef.current !== activeIndex) {
        positionRef.current = activeIndex;
        const targetCenterX = (activeIndex + 0.5) / count;
        animateGlassValue(centerX, targetCenterX, {
          duration: 0.38,
          ease: EASE,
        });
      }
    }
  }, [activeIndex, count, centerX]);

  /**
   * 从 clientX 计算连续位置并更新 center.x
   */
  const applyPointerX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const pad = 4; // p-1 = 4px
      const slot = (rect.width - pad * 2) / count;
      const raw = (clientX - rect.left - pad - slot / 2) / slot;
      const pos = Math.max(0, Math.min(count - 1, raw));
      positionRef.current = pos;
      const w = trackWRef.current;
      if (w > 0) {
        centerX.set(Math.max(0, Math.min(1, (pad + slot * pos + slot / 2) / w)));
      }
      return pos;
    },
    [count, centerX],
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

    dragCtx.current = { startX: e.clientX, hasMoved: false, targetIdxOnDown: clickedIdx };
    isPointerDownRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    if (!dragCtx.current.hasMoved && Math.abs(e.clientX - dragCtx.current.startX) > 4) {
      dragCtx.current.hasMoved = true;
      isDraggingRef.current = true;
      setIsDragging(true);
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
      setIsDragging(false);
      const target = Math.max(0, Math.min(count - 1, Math.round(positionRef.current)));
      const targetItem = items[target];
      if (targetItem) {
        onChange(targetItem);
        positionRef.current = target;
        const targetCenterX = (target + 0.5) / count;
        animateGlassValue(centerX, targetCenterX, {
          duration: 0.32,
          ease: EASE,
        });
      }
    } else {
      const clickedIdx = dragCtx.current.targetIdxOnDown;
      if (clickedIdx >= 0 && clickedIdx !== activeIndex) {
        transitionTo(clickedIdx);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = Math.max(0, Math.min(count - 1, activeIndex + delta));
    if (next !== activeIndex) {
      transitionTo(next);
      const nextItem = items[next];
      containerRef.current?.querySelector<HTMLButtonElement>(`[data-item="${nextItem}"]`)?.focus();
    }
  };

  const handleItemClick = (idx: number) => {
    if (idx !== activeIndex) {
      transitionTo(idx);
    }
  };

  // 透镜物理尺寸
  const pad = 4;
  const slotW = trackW > 0 ? (trackW - pad * 2) / count : 0;
  const pillW = slotW > 0 ? Math.round(slotW) : 0;
  const pillH = trackH > 0 ? trackH - pad * 2 : 0;

  // 严格调校的 Apple 物理光学参数（浅色背景控件标准）
  const optics: Partial<GlassOptics> = {
    mapSize: 256,
    depth: 0.25, // 浅水滴透镜：中心完全平坦，保持文字清晰锐利
    curvature: 0.3, // 轻柔曲率
    dispersion: 0.6, // 细腻微色散
    scaleX: 0.25, // 横向轻度物理折射
    scaleY: 0.08, // 纵向微折射，消除上下边缘切边黑线
    clipToShape: false,
    softEdge: true,
    splay: 0.5,
    bend: 0.06,
    bendWidth: 0.04,
    brightness: 0.01,
    specular: 1.5,
    sheenAngle: 45,
    sheenDark: false,
    sheen: 0.5,
    sheenWidth: 2,
    sheenFalloff: 1.5,
    glow: 0.04,
    glowSpread: 0.5,
    glowFalloff: 1.5,
    // 静止与移动阴影
    restEdgeShadow: "0 1px 3px rgba(0,0,0,0.16), 0 3px 8px rgba(0,0,0,0.08)",
    edgeShadow: "0 6px 18px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06)",
    edgeInsetShadow: "0 -2px 6px rgba(0,0,0,0.04)",
  };

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
      className={`liquid-glass-track relative h-12 touch-none select-none overflow-hidden rounded-full p-1 ${
        isDragging ? "cursor-grabbing" : "cursor-default"
      } ${className}`}
    >
      {/*
        Glass 透镜层（唯一文字内容来源，避免色散鬼影）
      */}
      {pillW > 0 && pillH > 0 && (
        <Glass
          style={{ position: "absolute", inset: 0, width: trackW, height: trackH }}
          width={pillW}
          height={pillH}
          radius={pillH / 2}
          center={{ x: centerX, y: 0.5 }}
          optics={optics}
          filterResolution={2}
        >
          {/* 被透镜折射的单一文字层 */}
          <div
            className="grid h-full w-full items-center p-1"
            style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
          >
            {items.map((item, idx) => (
              <div
                key={item}
                className={`flex items-center justify-center text-[13px] font-medium transition-colors sm:text-sm ${
                  idx === activeIndex ? "font-semibold text-ink" : "text-muted"
                }`}
              >
                {getLabel(item)}
              </div>
            ))}
          </div>
        </Glass>
      )}

      {/* SSR / 尺寸就绪前降级 */}
      {pillW === 0 && (
        <div
          className="grid h-full w-full items-center p-1"
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {items.map((item, idx) => (
            <div
              key={item}
              className={`flex items-center justify-center text-[13px] font-medium sm:text-sm ${
                idx === activeIndex ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              {getLabel(item)}
            </div>
          ))}
        </div>
      )}

      {/* 无障碍透明按钮层 */}
      <div
        className="absolute inset-1 z-20 grid"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {items.map((item, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`segmented-tab-${item}`}
              data-item={item}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleItemClick(idx)}
              className="inline-flex h-full w-full cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <span className="sr-only">{getLabel(item)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
