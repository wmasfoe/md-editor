"use client";

import { AiFeatureSection } from "./ai-feature-section";
import { DownloadPanel } from "./download-panel";
import { EditorFeatureSection } from "./editor-feature-section";
import { EditorPreviewStage } from "./editor-preview-stage";
import { HeroCta } from "./hero-cta";
import { InkpointWordmark } from "./inkpoint-wordmark";
import { MdxFeatureSection } from "./mdx-feature-section";
import type { ChangelogEntry } from "../lib/changelog";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import type { SitePlatform } from "../lib/platform";
import { PinnedScene } from "./pinned-scene";

interface HomeContentProps {
  latest?: ChangelogEntry;
  initialPlatform: SitePlatform;
}

export function HomeContent({ latest, initialPlatform }: HomeContentProps) {
  const { t } = useI18n();

  return (
    <main className="relative">
      {/* Hero：行程只够完成 3D 翻转，标题保持原位，不把首屏拉成空长卷 */}
      <PinnedScene
        id="hero"
        heightVh={155}
        frameClassName="ink-hero bg-canvas z-[1] overflow-visible"
      >
        {({ progress, prefersReducedMotion }) => {
          const splashesOffset = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [0, 12]);
          const sealOffset = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [0, 8]);
          const ambientOffset = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [0, 18]);

          return (
            <div className="relative flex h-full flex-col">
              <div
                aria-hidden
                style={{
                  transform: `translate3d(0, ${ambientOffset}px, 0)`,
                  willChange: "transform",
                }}
                className="pointer-events-none absolute -top-36 left-1/2 -z-10 h-[820px] w-[1140px] -translate-x-1/2 rounded-full opacity-70 blur-3xl"
              >
                <div className="h-full w-full bg-radial from-accent/15 via-blot/8 to-transparent" />
              </div>

              <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center px-4 pb-6 pt-16 sm:px-8 sm:pb-8 sm:pt-[4.5rem]">
                <div className="mx-auto w-full max-w-2xl shrink-0 text-center">
                  <h1 className="flex flex-col items-center">
                    <InkpointWordmark
                      size="hero"
                      splashesOffset={splashesOffset}
                      sealOffset={sealOffset}
                    />
                    <span className="ink-float-gentle mt-4 text-pretty text-lg font-normal tracking-tight text-ink-soft sm:mt-5 sm:text-2xl">
                      {t.hero.tagline}
                    </span>
                  </h1>
                  <p className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-muted sm:mt-6 sm:text-lg">
                    {t.hero.subtitle}
                  </p>
                  <HeroCta />
                </div>

                <div className="relative mt-8 shrink-0 sm:mt-10">
                  <EditorPreviewStage
                    progress={progress}
                    prefersReducedMotion={prefersReducedMotion}
                  />
                </div>
              </div>
            </div>
          );
        }}
      </PinnedScene>

      <EditorFeatureSection />
      <AiFeatureSection />
      <MdxFeatureSection />

      <section
        id="download"
        aria-label={t.download.sectionTitle}
        className="relative scroll-mt-16 border-t border-line/80 bg-surface/40 py-16 backdrop-blur-xs sm:scroll-mt-20 sm:py-24"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
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
    </main>
  );
}
