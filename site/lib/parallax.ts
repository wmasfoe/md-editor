"use client";

import { useEffect, useState } from "react";

/**
 * 高性能 Apple 级视差滚动 Hook：
 * 1. 采用 requestAnimationFrame 限制至 60/120Hz 帧率，杜绝主线程频繁触发重排；
 * 2. 采用 passive: true 监听，不阻塞浏览器原生滚动与触控手势；
 * 3. 自动检测并响应 prefers-reduced-motion，若用户系统开启「减弱动态效果」则平滑降级为 0 偏移；
 * 4. 提供微缓动插值因子与安全的视口偏移计算。
 */
export function useParallaxScroll() {
  const [scrollY, setScrollY] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(motionQuery.matches);

    const handleMotionChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    motionQuery.addEventListener("change", handleMotionChange);

    let rafId: number | null = null;
    let lastScrollY = window.scrollY;

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (Math.abs(currentY - lastScrollY) >= 0.5) {
          lastScrollY = currentY;
          setScrollY(currentY);
        }
        rafId = null;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    setScrollY(window.scrollY);

    return () => {
      motionQuery.removeEventListener("change", handleMotionChange);
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

/**
 * 线性插值映射函数 (Apple-style Scroll Interpolator)
 */
export function interpolate(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number],
  clamp: boolean = true,
): number {
  const [inMin, inMax] = inputRange;
  const [outMin, outMax] = outputRange;

  if (inMin === inMax) return outMin;

  const progress = (value - inMin) / (inMax - inMin);
  const result = outMin + progress * (outMax - outMin);

  if (!clamp) return result;

  const min = Math.min(outMin, outMax);
  const max = Math.max(outMin, outMax);
  return Math.min(Math.max(result, min), max);
}
