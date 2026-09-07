"use client";

import Link from "next/link";
import { AiFeatureSection } from "./ai-feature-section";
import { DownloadPanel } from "./download-panel";
import { EditorFeatureSection } from "./editor-feature-section";
import { EditorPreviewStage } from "./editor-preview-stage";
import { HeroCta } from "./hero-cta";
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

  // 状态与规划卡片视差位移
  const statusLeftY = prefersReducedMotion ? 0 : interpolate(scrollY, [2600, 3600], [45, -25]);
  const statusRightY = prefersReducedMotion ? 0 : interpolate(scrollY, [2600, 3600], [25, -35]);

  return (
    <main className="relative overflow-hidden">
      {/* 视差光晕背景：深邃的宣纸墨晕空间 */}
      <div
        aria-hidden
        style={{
          transform: `translate3d(0, ${ambientBgOffset}px, 0)`,
          willChange: "transform",
        }}
        className="pointer-events-none absolute -top-36 left-1/2 -z-10 h-[820px] w-[1140px] -translate-x-1/2 rounded-full opacity-70 blur-3xl"
      >
        <div className="h-full w-full bg-radial from-accent/15 via-blot/8 to-transparent" />
      </div>

      {/* Hero 区域：词标、标语与极简 CTA */}
      <section className="ink-hero relative pt-8 sm:pt-16">
        <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-8 sm:pb-12">
          <div
            style={{
              transform: `translate3d(0, ${heroTextY}px, 0) scale(${heroTextScale})`,
              opacity: heroTextOpacity,
              willChange: "transform, opacity",
            }}
            className="mx-auto max-w-2xl text-center"
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

            {/* 极简双行动组：纯粹的探索与导航引导 */}
            <HeroCta />
          </div>

          {/* 3D Parallax Desktop Preview Stage */}
          <EditorPreviewStage scrollY={scrollY} prefersReducedMotion={prefersReducedMotion} />
        </div>
      </section>

      {/* Feature 展区 1：轻量无标题栏真实 Live 编辑器体验区 */}
      <EditorFeatureSection scrollY={scrollY} prefersReducedMotion={prefersReducedMotion} />

      {/* Feature 展区 2：端侧本地 AI 智能赋能区 */}
      <AiFeatureSection scrollY={scrollY} prefersReducedMotion={prefersReducedMotion} />

      {/* 底部专门的终极转化区（Download Section） */}
      <section
        id="download"
        aria-label={t.download.sectionTitle}
        className="relative scroll-mt-16 border-t border-line/80 bg-surface/40 py-16 backdrop-blur-xs sm:scroll-mt-20 sm:py-24"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              <span>{t.download.sectionBadge}</span>
            </div>

            <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
              {t.download.sectionTitle}
            </h2>

            <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
              {t.download.sectionSubtitle}
            </p>
          </div>

          <DownloadPanel initialPlatform={initialPlatform} version={latest?.version} />
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
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                {latest.items[0]?.text ??
                  (typeof latest.items[0] === "string" ? latest.items[0] : "")}
              </p>
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
