"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import { PinnedScene } from "./pinned-scene";

function EditorSkeleton({ isZh }: { isZh: boolean }) {
  return (
    <div className="flex h-full min-h-[280px] w-full items-center justify-center rounded-3xl border border-line-strong/80 bg-surface/80 p-8 shadow-[0_24px_64px_-12px_rgba(20,18,15,0.08)]">
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

export function EditorFeatureSection() {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  return (
    <PinnedScene
      id="features"
      ariaLabel={isZh ? "基础编辑体验" : "Core Editor Experience"}
      heightVh={200}
      frameClassName="bg-canvas z-[2]"
    >
      {({ progress, prefersReducedMotion }) => {
        // 编辑区从标题下方升起，逐步覆盖文案
        const titleOpacity = prefersReducedMotion ? 1 : interpolate(progress, [0.08, 0.52], [1, 0]);
        const titleY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.52], [0, -36]);
        const editorTop = prefersReducedMotion ? 18 : interpolate(progress, [0, 0.72], [40, 11]);
        const editorScale = prefersReducedMotion ? 1 : interpolate(progress, [0, 0.55], [0.96, 1]);
        const editorY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.55], [28, 0]);

        return (
          <div className="relative h-full overflow-hidden">
            <div
              style={{
                opacity: titleOpacity,
                transform: `translate3d(0, ${titleY}px, 0)`,
              }}
              className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-8 sm:pt-[4.5rem]"
              aria-hidden={titleOpacity < 0.12}
            >
              <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span>{isZh ? "所见即所得 · 纯粹书写" : "WYSIWYG & PURE CRAFT"}</span>
              </div>

              <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
                {isZh ? "即开即写，让文字回归纯粹" : "Instant, Distraction-Free Typography"}
              </h2>

              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
                {isZh
                  ? "无需复杂配置，也不必等待加载。在宣纸般温润的画布上，所见即所想，格式随行而生。"
                  : "No setup, no waiting. Experience instant inline formatting on a warm paper-like canvas."}
              </p>
            </div>

            <div
              style={{
                top: `${editorTop}%`,
                transform: `translate3d(0, ${editorY}px, 0) scale(${editorScale})`,
                transformOrigin: "center top",
                willChange: "transform, top",
              }}
              className="absolute inset-x-0 bottom-5 mx-auto w-full max-w-5xl px-4 sm:bottom-7 sm:px-8"
            >
              <DynamicSiteLiveEditor className="h-full" />
            </div>
          </div>
        );
      }}
    </PinnedScene>
  );
}
