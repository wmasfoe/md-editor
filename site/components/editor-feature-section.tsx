"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";

interface EditorFeatureSectionProps {
  scrollY: number;
  prefersReducedMotion: boolean;
}

function EditorSkeleton({ isZh }: { isZh: boolean }) {
  return (
    <div className="flex min-h-[300px] sm:min-h-[340px] w-full items-center justify-center rounded-3xl border border-line-strong/80 bg-surface/80 p-8 shadow-[0_24px_64px_-12px_rgba(20,18,15,0.08)]">
      <div className="flex flex-col items-center gap-2.5 text-muted">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span className="text-xs">
          {isZh ? "正在准备书写画布..." : "Preparing writing canvas..."}
        </span>
      </div>
    </div>
  );
}

const DynamicSiteLiveEditor = dynamic(
  () => import("./site-live-editor").then((mod) => mod.SiteLiveEditor),
  {
    ssr: false,
    loading: () => <EditorSkeleton isZh={true} />,
  },
);

export function EditorFeatureSection({ scrollY, prefersReducedMotion }: EditorFeatureSectionProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  // 视差微动：滚动接近展区时平缓升起并微微放大
  const translateY = prefersReducedMotion ? 0 : interpolate(scrollY, [350, 950], [35, -15]);
  const scale = prefersReducedMotion ? 1 : interpolate(scrollY, [350, 950], [0.97, 1.0]);

  return (
    <section
      id="features"
      aria-label={isZh ? "基础编辑体验" : "Core Editor Experience"}
      className="relative mx-auto mt-16 max-w-5xl scroll-mt-20 px-4 sm:mt-24 sm:scroll-mt-24 sm:px-8"
    >
      {/* 展区头部：优雅居中标题与徽标 */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span>{isZh ? "所见即所得 · 纯粹书写" : "WYSIWYG & PURE CRAFT"}</span>
        </div>

        <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
          {isZh ? "即开即写，让文字回归纯粹" : "Instant, Distraction-Free Typography"}
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
          {isZh
            ? "无需复杂配置，也不必等待加载。在宣纸般温润的画布上，所见即所想，格式随行而生。"
            : "No setup, no waiting. Experience instant inline formatting on a warm paper-like canvas."}
        </p>
      </div>

      {/* 视差升起舞台：承载无标题栏真实 Live 编辑器 */}
      <div
        style={{
          transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
          willChange: "transform",
        }}
        className="mt-8 sm:mt-12"
      >
        <DynamicSiteLiveEditor />
      </div>
    </section>
  );
}
