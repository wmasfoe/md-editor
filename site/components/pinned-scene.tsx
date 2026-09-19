"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useIsDesktopPinned, usePrefersReducedMotion, useSceneSnapshot } from "../lib/parallax";

export interface SceneRenderState {
  /** 当前场景钉住行程的 0–1 进度 */
  progress: number;
  /** 该场景是否正盖住视口（当前展示区块） */
  isActive: boolean;
  prefersReducedMotion: boolean;
  /** 是否处于桌面钉住视差模式；移动端或用户减弱动态时为 false */
  isPinned: boolean;
}

interface PinnedSceneProps {
  id: string;
  ariaLabel?: string;
  /** 桌面钉住行程高度，单位 vh。移动端 / 减弱动态效果时由 CSS 降级为内容高度。 */
  heightVh?: number;
  className?: string;
  frameClassName?: string;
  children: (state: SceneRenderState) => ReactNode;
}

/**
 * Apple 官网式钉住场景：外层拉长滚动行程，内层 sticky 占满视口。
 * 移动端 / 减弱动态效果时平滑降级为常规内容流式排版，杜绝元素折叠或无法滚动。
 */
export function PinnedScene({
  id,
  ariaLabel,
  heightVh = 220,
  className,
  frameClassName,
  children,
}: PinnedSceneProps) {
  const trackRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isDesktopPinned = useIsDesktopPinned();
  const shouldPin = !prefersReducedMotion && isDesktopPinned;
  const { progress, isActive } = useSceneSnapshot(trackRef, shouldPin);

  return (
    <section
      ref={trackRef}
      id={id}
      aria-label={ariaLabel}
      className={["pinned-scene-track", className].filter(Boolean).join(" ")}
      style={{ "--pinned-scene-height": `${heightVh}vh` } as CSSProperties}
    >
      <div className={["pinned-scene-frame", frameClassName].filter(Boolean).join(" ")}>
        {children({
          progress: shouldPin ? progress : 1,
          isActive: shouldPin ? isActive : true,
          prefersReducedMotion,
          isPinned: shouldPin,
        })}
      </div>
    </section>
  );
}
