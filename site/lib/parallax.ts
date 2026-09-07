"use client";

import { useEffect, useState, type RefObject } from "react";

/** 桌面钉住滚动的媒体条件：与 globals.css 中 `.pinned-scene-track` 保持同步 */
export const PINNED_SCENE_MEDIA = "(min-width: 768px) and (min-height: 700px)";

/**
 * 高性能 Apple 级视差滚动 Hook：
 * 1. 采用 requestAnimationFrame 限制至 60/120Hz 帧率，杜绝主线程频繁触发重排；
 * 2. 采用 passive: true 监听，不阻塞浏览器原生滚动与触控手势；
 * 3. 自动检测并响应 prefers-reduced-motion，若用户系统开启「减弱动态效果」则平滑降级为 0 偏移；
 * 4. 提供微缓动插值因子与安全的视口偏移计算。
 */
export function useParallaxScroll() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number | null = null;
    let lastScrollY = window.scrollY;

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (Math.abs(currentY - lastScrollY) >= 2) {
          lastScrollY = currentY;
          setScrollY(currentY);
        }
        rafId = null;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    setScrollY(window.scrollY);

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return {
    scrollY: prefersReducedMotion ? 0 : scrollY,
    prefersReducedMotion,
  };
}

/**
 * 系统「减弱动态效果」订阅。SSR / 首帧默认为 false，水合后再对齐真实偏好。
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(motionQuery.matches);
    motionQuery.addEventListener("change", handleMotionChange);
    return () => motionQuery.removeEventListener("change", handleMotionChange);
  }, []);

  return prefersReducedMotion;
}

/**
 * 计算视差偏移值（支持最大/最小界限裁剪，防止大幅滚动时元素出格）
 */
export function calculateParallaxOffset(
  scrollY: number,
  speed: number,
  min: number = -240,
  max: number = 240,
): number {
  const raw = scrollY * speed;
  return Math.min(Math.max(raw, min), max);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 线性插值映射函数 (Apple-style Scroll Interpolator)
 */
export function interpolate(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number],
  clampOutput: boolean = true,
): number {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;

  if (inMin === inMax) return outMin;

  const progress = (value - inMin) / (inMax - inMin);
  const result = outMin + progress * (outMax - outMin);

  if (!clampOutput) return result;

  const min = Math.min(outMin, outMax);
  const max = Math.max(outMin, outMax);
  return Math.min(Math.max(result, min), max);
}

/**
 * 将钉住场景的几何信息映射为 0–1 进度：
 * - 场景顶边贴齐视口顶边时为 0（内部动画起点）；
 * - 场景底边贴齐视口底边时为 1（切到下一区块）；
 * - 场景高度不足以产生钉住行程时直接视为 1，避免移动端被锁在起始态。
 */
export function sceneProgressFromRect(
  rectTop: number,
  sectionHeight: number,
  viewportHeight: number,
): number {
  const travel = sectionHeight - viewportHeight;
  if (travel <= 0) return 1;
  return clamp(-rectTop / travel, 0, 1);
}

/**
 * 钉住场景是否正盖住视口：顶边已过视口顶、底边仍压住视口底。
 * 用于「当前展示区块」判定（例如 AI 展区自动进入 Tab 就绪）。
 */
export function sceneIsActiveFromRect(
  rectTop: number,
  sectionHeight: number,
  viewportHeight: number,
): boolean {
  const rectBottom = rectTop + sectionHeight;
  if (sectionHeight <= viewportHeight) {
    return rectTop < viewportHeight * 0.45 && rectBottom > viewportHeight * 0.55;
  }
  return rectTop <= 0 && rectBottom >= viewportHeight - 1;
}

export interface SceneSnapshot {
  progress: number;
  isActive: boolean;
}

/**
 * 读取钉住场景在当前滚动位置的 0–1 进度，以及是否正盖住视口。
 * `enabled` 为 false（减弱动态效果）时进度固定为 1。
 */
export function useSceneSnapshot(
  trackRef: RefObject<HTMLElement | null>,
  enabled: boolean = true,
): SceneSnapshot {
  const [snapshot, setSnapshot] = useState<SceneSnapshot>({
    progress: enabled ? 0 : 1,
    isActive: false,
  });

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ progress: 1, isActive: true });
      return;
    }

    const element = trackRef.current;
    if (!element) return;

    let rafId = 0;
    let lastProgress = -1;
    let lastActive: boolean | null = null;

    const update = () => {
      rafId = 0;
      const rectTop = element.getBoundingClientRect().top;
      const height = element.offsetHeight;
      const viewportHeight = window.innerHeight;
      const nextProgress = sceneProgressFromRect(rectTop, height, viewportHeight);
      const nextActive = sceneIsActiveFromRect(rectTop, height, viewportHeight);
      if (Math.abs(nextProgress - lastProgress) < 0.002 && nextActive === lastActive) return;
      lastProgress = nextProgress;
      lastActive = nextActive;
      setSnapshot({ progress: nextProgress, isActive: nextActive });
    };

    const onScrollOrResize = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    update();

    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, [enabled, trackRef]);

  return enabled ? snapshot : { progress: 1, isActive: true };
}

export function useSceneProgress(
  trackRef: RefObject<HTMLElement | null>,
  enabled: boolean = true,
): number {
  return useSceneSnapshot(trackRef, enabled).progress;
}
