"use client";

import Link from "next/link";
import { DownloadPanel } from "./download-panel";
import { EditorPreviewStage } from "./editor-preview-stage";
import { InkpointWordmark } from "./inkpoint-wordmark";
import type { ChangelogEntry } from "../lib/changelog";
import { buildDownloadCatalog } from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { calculateParallaxOffset, interpolate, useParallaxScroll } from "../lib/parallax";
import type { SitePlatform } from "../lib/platform";

interface HomeContentProps {
  latest?: ChangelogEntry;
  initialPlatform: SitePlatform;
}

export function HomeContent({ latest, initialPlatform }: HomeContentProps) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh";
  const { scrollY, prefersReducedMotion } = useParallaxScroll();
  const catalog = buildDownloadCatalog(latest?.version, locale);

  // Hero 文本视差：滚动时微微后退与轻微淡化，让视觉重心平滑转移给下方的编辑器实物窗口
  const heroTextY = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 450], [0, -45]);
  const heroTextOpacity = prefersReducedMotion ? 1 : interpolate(scrollY, [0, 500], [1, 0.45]);
  const heroTextScale = prefersReducedMotion ? 1 : interpolate(scrollY, [0, 500], [1, 0.95]);

  // 水墨装饰层大幅度差速
  const splashesOffset = prefersReducedMotion ? 0 : calculateParallaxOffset(scrollY, 0.35, -90, 90);
  const sealOffset = prefersReducedMotion ? 0 : calculateParallaxOffset(scrollY, 0.18, -50, 50);
  const ambientBgOffset = prefersReducedMotion
    ? 0
    : calculateParallaxOffset(scrollY, 0.25, -120, 120);

  // 特性 Bento 卡片大幅度交错视差位移 (Staggered Bento Lift)
  const card0Y = prefersReducedMotion ? 0 : interpolate(scrollY, [200, 850], [50, -30]);
  const card1Y = prefersReducedMotion ? 0 : interpolate(scrollY, [200, 850], [90, 15]);
  const card2Y = prefersReducedMotion ? 0 : interpolate(scrollY, [200, 850], [40, -40]);
  const cardOffsets = [card0Y, card1Y, card2Y];

  // 状态与规划卡片视差位移
  const statusLeftY = prefersReducedMotion ? 0 : interpolate(scrollY, [550, 1200], [45, -25]);
  const statusRightY = prefersReducedMotion ? 0 : interpolate(scrollY, [550, 1200], [25, -35]);

  return (
    <main className="relative overflow-hidden">
      {/* 视差光晕背景：深邃的宣纸墨晕空间 */}
      <div
        aria-hidden
        style={{
          transform: `translate3d(0, ${ambientBgOffset}px, 0)`,
          willChange: "transform",
        }}
        className="pointer-events-none absolute -top-36 left-1/2 -z-10 h-[820px] w-[1140px] -translate-x-1/2 rounded-full opacity-70 blur-3xl transition-transform duration-100 ease-out"
      >
        <div className="h-full w-full bg-radial from-accent/15 via-blot/8 to-transparent" />
      </div>

      {/* Hero 区域：词标、标语与下载组件 */}
      <section className="ink-hero relative pt-8 sm:pt-16">
        <div className="mx-auto max-w-5xl px-4 pb-10 sm:px-8 sm:pb-14">
          <div
            style={{
              transform: `translate3d(0, ${heroTextY}px, 0) scale(${heroTextScale})`,
              opacity: heroTextOpacity,
              willChange: "transform, opacity",
            }}
            className="mx-auto max-w-2xl text-center transition-all duration-75 ease-out"
          >
            <h1 className="flex flex-col items-center">
              <InkpointWordmark
                size="hero"
                splashesOffset={splashesOffset}
                sealOffset={sealOffset}
              />
              <span className="mt-4 text-pretty text-lg font-normal tracking-tight text-ink-soft sm:mt-5 sm:text-2xl">
                {t.hero.tagline}
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-muted sm:mt-6 sm:text-lg">
              {t.hero.subtitle}
            </p>

            <DownloadPanel initialPlatform={initialPlatform} version={latest?.version} />
          </div>

          {/* Apple 官网级 3D 视差展开的桌面端实物窗口展示舞台 */}
          <EditorPreviewStage scrollY={scrollY} prefersReducedMotion={prefersReducedMotion} />
        </div>
      </section>

      {/* 能力要点：Bento 网格与大幅度交错视差 */}
      <section
        aria-label={t.features.sectionAria}
        className="border-y border-line/80 bg-surface/50 py-12 backdrop-blur-md sm:py-20"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          <div className="grid gap-5 sm:grid-cols-3 sm:gap-6">
            {t.features.items.map((feature, idx) => (
              <div
                key={feature.title}
                style={{
                  transform: `translate3d(0, ${cardOffsets[idx] ?? 0}px, 0)`,
                  willChange: "transform",
                }}
                className="group relative flex flex-col justify-between rounded-3xl border border-line bg-canvas p-6 shadow-[0_4px_20px_rgba(20,18,15,0.03)] transition-all duration-300 hover:border-line-strong hover:bg-surface hover:shadow-[0_12px_32px_rgba(20,18,15,0.08)] sm:p-8"
              >
                <div>
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-surface-soft/80 text-lg shadow-xs">
                    {idx === 0 ? "💾" : idx === 1 ? "⚡️" : "⌨️"}
                  </div>
                  <h2 className="text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent sm:text-lg">
                    {feature.title}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted transition-colors group-hover:text-ink-soft sm:text-[15px]">
                    {feature.description}
                  </p>
                </div>

                {/* 装饰性徽标微预览 */}
                <div className="mt-6 pt-4 border-t border-line/50 text-[11px] text-muted flex items-center justify-between">
                  <span>
                    {idx === 0
                      ? isZh
                        ? "本地磁盘"
                        : "Local Disk"
                      : idx === 1
                        ? "MDX & React"
                        : "macOS / Win / Linux"}
                  </span>
                  <span className="font-mono text-ink/70">
                    {idx === 0 ? "0 Cloud" : idx === 1 ? "100% Fidelity" : "⌘ Keymaps"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 版本与状态：两列信息卡，带有视差浮动与 Apple 悬浮质感 */}
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 sm:gap-6 sm:px-8 sm:py-20">
        <article
          style={{
            transform: `translate3d(0, ${statusLeftY}px, 0)`,
            willChange: "transform",
          }}
          className="rounded-3xl border border-line bg-surface p-6 shadow-[0_4px_20px_rgba(20,18,15,0.03)] transition-all duration-300 hover:border-line-strong hover:shadow-[0_12px_32px_rgba(20,18,15,0.08)] sm:p-8"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-muted">{t.status.latestTitle}</h2>
            {latest ? (
              <Link
                href="/changelog"
                className="inline-flex min-h-10 items-center text-sm font-medium text-accent transition-opacity hover:opacity-80 sm:min-h-0"
              >
                {t.status.allChangelog}
              </Link>
            ) : null}
          </div>
          {latest ? (
            <>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                v{latest.version}
              </p>
              <p className="mt-1 text-sm text-muted">{latest.date}</p>
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">{latest.items[0]}</p>
              <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
                <a
                  href="#download"
                  className="inline-flex min-h-10 items-center text-sm font-medium text-ink transition-opacity hover:opacity-80 sm:min-h-0"
                >
                  {t.status.downloadVersion}
                </a>
                <a
                  href={catalog.allPackagesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center text-sm text-muted transition-colors hover:text-ink sm:min-h-0"
                >
                  {t.status.historyVersions}
                </a>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">{t.status.noChangelog}</p>
          )}
        </article>

        <article
          style={{
            transform: `translate3d(0, ${statusRightY}px, 0)`,
            willChange: "transform",
          }}
          className="rounded-3xl border border-line bg-surface p-6 shadow-[0_4px_20px_rgba(20,18,15,0.03)] transition-all duration-300 hover:border-line-strong hover:shadow-[0_12px_32px_rgba(20,18,15,0.08)] sm:p-8"
        >
          <h2 className="text-sm font-medium tracking-wide text-muted">{t.status.webAppTitle}</h2>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {t.status.webAppStatus}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">{t.status.webAppDescription}</p>
          <span className="mt-6 inline-flex rounded-full border border-line bg-surface-soft px-3 py-1 text-xs font-medium text-muted">
            {t.status.notOpenYet}
          </span>
        </article>
      </section>
    </main>
  );
}
