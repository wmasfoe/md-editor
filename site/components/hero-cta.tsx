"use client";

import { useI18n } from "../lib/i18n/context";

export function HeroCta() {
  const { t } = useI18n();

  return (
    <div className="mx-auto mt-7 flex flex-col items-center sm:mt-9">
      {/* 极简双行动组：纯粹的探索与导航引导 */}
      <div className="flex flex-wrap items-center justify-center gap-3.5 sm:gap-4">
        {/* 主行动点：平滑滚动深入探索 3D 舞台与 Live 编辑器 */}
        <a
          href="#features"
          className="liquid-glass-button-dark group relative inline-flex h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-7 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(20,18,15,0.12)] transition-all hover:shadow-[0_12px_36px_rgba(20,18,15,0.2)] active:translate-y-[1px]"
        >
          {/* 顶层液态镜面微光扫掠 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/18 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
          />
          <span className="relative z-10 font-semibold tracking-tight">
            {t.hero.exploreFeatures}
          </span>
          <svg
            className="relative z-10 h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </a>

        {/* 次行动点：平滑滚动直达底部下载区 */}
        <a
          href="#download"
          className="group inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong/80 bg-surface/80 px-6 text-sm font-medium text-ink shadow-xs backdrop-blur-sm transition-all hover:border-line-strong hover:bg-surface hover:text-accent active:translate-y-[1px]"
        >
          <span>{t.hero.getClient}</span>
          <svg
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-y-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
