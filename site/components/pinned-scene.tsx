"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { usePrefersReducedMotion, useSceneSnapshot } from "../lib/parallax";

export interface SceneRenderState {
  /** 当前场景钉住行程的 0–1 进度 */
  progress: number;
  /** 该场景是否正盖住视口（当前展示区块） */
  isActive: boolean;
  prefersReducedMotion: boolean;
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
 * 滚动只驱动 `progress`，区块本身钉在视口内；行程走完后由下一场景覆盖接棒。
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
  const { progress, isActive } = useSceneSnapshot(trackRef, !prefersReducedMotion);

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
          progress: prefersReducedMotion ? 1 : progress,
          isActive: prefersReducedMotion ? true : isActive,
          prefersReducedMotion,
        })}
      </div>
    </section>
  );
}
