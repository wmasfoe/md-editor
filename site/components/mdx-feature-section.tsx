"use client";

import dynamic from "next/dynamic";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import { PinnedScene } from "./pinned-scene";

function EditorSkeleton({ isZh }: { isZh: boolean }) {
  return (
    <div className="flex h-full min-h-[280px] w-full items-center justify-center rounded-3xl border border-line-strong/80 bg-surface/80 p-8">
      <div className="flex flex-col items-center gap-2.5 text-muted">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span className="text-xs">{isZh ? "正在准备 MDX 画布..." : "Preparing MDX canvas..."}</span>
      </div>
    </div>
  );
}

const DynamicMdxWipeCanvas = dynamic(
  () => import("./mdx-wipe-canvas").then((mod) => mod.MdxWipeCanvas),
  {
    ssr: false,
    loading: () => <EditorSkeleton isZh={true} />,
  },
);

/**
 * MDX 展区：右侧不透明源码层随滚动盖住左侧所见即所得，两边可编辑且内容同步。
 */
export function MdxFeatureSection() {
  const { locale, t } = useI18n();
  const isZh = locale === "zh";
  const copy = t.mdxShowcase;

  return (
    <PinnedScene
      id="mdx"
      ariaLabel={isZh ? "MDX 组件体验" : "MDX component showcase"}
      heightVh={200}
      frameClassName="bg-canvas z-[4]"
    >
      {({ progress, prefersReducedMotion }) => {
        const headerOpacity = prefersReducedMotion
          ? 1
          : interpolate(progress, [0, 0.16], [0.75, 1]);
        const headerY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.2], [16, 0]);
        const stageY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.28], [22, 0]);
        const sourceReveal = prefersReducedMotion
          ? 100
          : interpolate(progress, [0.16, 0.82], [18, 100]);

        return (
          <div className="mx-auto flex h-full max-w-5xl flex-col px-4 pb-6 pt-16 sm:px-8 sm:pb-8 sm:pt-[4.5rem]">
            <div
              style={{
                opacity: headerOpacity,
                transform: `translate3d(0, ${headerY}px, 0)`,
              }}
              className="mx-auto max-w-2xl shrink-0 text-center"
            >
              <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-seal" />
                <span>{copy.sectionBadge}</span>
              </div>
              <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
                {copy.sectionTitle}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
                {copy.sectionSubtitle}
              </p>
            </div>

            <div
              style={{
                transform: `translate3d(0, ${stageY}px, 0)`,
              }}
              className="mt-5 min-h-0 flex-1 sm:mt-6"
            >
              <DynamicMdxWipeCanvas
                sourceReveal={sourceReveal}
                previewLabel={copy.previewLabel}
                sourceLabel={copy.sourceLabel}
                filename={copy.sourceFilename}
              />
            </div>
          </div>
        );
      }}
    </PinnedScene>
  );
}
