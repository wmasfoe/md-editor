"use client";

import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import { SatelliteBadge } from "./satellite-badge";

interface EditorPreviewStageProps {
  progress: number;
  prefersReducedMotion: boolean;
}

/**
 * Apple 官网级产品舞台（Editor Showcase Stage）:
 * 1. 3D 透视展开展现：钉住行程内从俯仰视角 (rotateX: 14deg) 平滑展开至正视平面；
 * 2. 窗口尺寸与景深投影：随场景进度微缩放并加深环境漫反射投影；
 * 3. 浮动视差挂件：3 枚特性徽标差速浮动，点击跳转到对应钉住区块；
 * 4. 编辑器实例文档：以霞鹜文楷呈现逼真的 Markdown / MDX 写作与代码高亮排版。
 */
export function EditorPreviewStage({ progress, prefersReducedMotion }: EditorPreviewStageProps) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh";
  const badges = t.previewBadges;

  // 向内翻转：默认俯视收在 10deg，避免一开始就把侧边挂件压住
  const rotateX = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.9], [10, 0]);
  const scale = prefersReducedMotion ? 1 : interpolate(progress, [0, 0.9], [0.97, 1]);
  const translateY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.9], [12, -18]);

  const badgeLeftY = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [-24, 40]);
  const badgeRightY = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [36, -48]);
  const badgeBottomY = prefersReducedMotion ? 0 : interpolate(progress, [0, 1], [-8, 28]);

  return (
    <div
      id="preview-stage"
      className="relative mx-auto w-full max-w-5xl px-8 sm:px-16"
      style={{ perspective: "1200px", transformStyle: "preserve-3d" }}
    >
      {/* 主应用视窗先绘制；挂件后置并抬到 z=64，避免 3D 翻转把浮块压住 */}
      <div
        style={{
          transform: `rotateX(${rotateX}deg) scale(${scale}) translate3d(0, ${translateY}px, 0)`,
          transformOrigin: "center top",
          willChange: "transform",
        }}
        className="overflow-hidden rounded-2xl border border-line-strong/80 bg-surface shadow-[0_24px_64px_-12px_rgba(20,18,15,0.16),0_0_0_1px_rgba(20,18,15,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]"
      >
        {/* macOS 风格红绿灯标题栏 */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface-soft/80 px-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57] ring-1 ring-black/10" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e] ring-1 ring-black/10" />
            <span className="h-3 w-3 rounded-full bg-[#28c840] ring-1 ring-black/10" />
          </div>

          <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <span className="text-ink">Inkpoint</span>
            <span className="text-line-strong">/</span>
            <span>{isZh ? "专注写作.md" : "focus-writing.md"}</span>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span>WYSIWYG</span>
          </div>
        </div>

        {/* 编辑器双栏布局：微型文件侧栏 + 写作工作面 */}
        <div className="grid grid-cols-1 md:grid-cols-12">
          <div className="hidden border-r border-line bg-canvas/60 p-3.5 md:col-span-3 md:block">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {isZh ? "工作区" : "WORKSPACE"}
            </p>
            <ul className="space-y-1 text-xs text-ink-soft">
              <li className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-surface-soft">
                <span>📁</span>
                <span>essays</span>
              </li>
              <li className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 font-medium text-ink shadow-xs">
                <span>📄</span>
                <span className="truncate">{isZh ? "专注写作.md" : "focus-writing.md"}</span>
              </li>
              <li className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-surface-soft">
                <span>📄</span>
                <span>architecture.mdx</span>
              </li>
              <li className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-surface-soft">
                <span>📄</span>
                <span>release-notes.md</span>
              </li>
            </ul>
          </div>

          <div className="min-h-0 overflow-hidden p-6 md:col-span-9 md:p-8">
            <div className="prose max-w-none text-ink">
              <h1 className="font-sans text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {t.hero.previewHeading}
              </h1>

              <blockquote className="my-3 border-l-2 border-accent/60 pl-3.5 text-sm italic text-muted">
                {isZh
                  ? "没有繁琐的界面工具栏堆叠，让光标回到文字呼吸本身。"
                  : "Zero cluttered toolbars. Keep your focus entirely in the flow of thought."}
              </blockquote>

              <p className="text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
                {isZh
                  ? "Inkpoint 结合了所见即所得的流畅排版与原汁原味的 Markdown / MDX 源码保真度。文档永远留在你的本地磁盘上，无需登录，即开即写。"
                  : "Inkpoint delivers instant WYSIWYG elegance without sacrificing full Markdown/MDX source fidelity. Your thoughts stay on your disk."}
              </p>

              <div className="my-4 overflow-hidden rounded-xl border border-line bg-surface-soft/80 p-3 font-mono text-[12px] leading-relaxed text-ink-soft shadow-xs sm:text-[13px]">
                <div className="flex items-center justify-between pb-2 text-[11px] text-muted">
                  <span>article.mdx</span>
                  <span className="text-accent">Live Preview</span>
                </div>
                <div className="border-t border-line/60 pt-2 text-ink">
                  <span className="text-accent">export const</span> meta = &#123; author:{" "}
                  <span className="text-seal">&quot;Inkpoint&quot;</span> &#125;;
                  <br />
                  <span className="text-muted">&#60;</span>
                  <span className="text-blot font-semibold">Callout</span>
                  <span className="text-muted">&#62;</span>
                  {isZh
                    ? " 极简、本地、专注于长文排版。"
                    : " Distraction-free, local-first typography."}
                  <span className="text-muted">&#60;/</span>
                  <span className="text-blot font-semibold">Callout</span>
                  <span className="text-muted">&#62;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SatelliteBadge
        href="#features"
        icon="✒️"
        iconClassName="bg-accent/10"
        title={badges.editor.title}
        description={badges.editor.description}
        rotate={-2}
        translateY={badgeLeftY}
        className="-left-1 top-8 sm:-left-3"
      />

      <SatelliteBadge
        href="#ai"
        icon="✨"
        iconClassName="bg-blot/10"
        title={badges.ai.title}
        description={badges.ai.description}
        rotate={2.5}
        translateY={badgeRightY}
        className="-right-1 top-24 sm:-right-3"
      />

      <SatelliteBadge
        href="#mdx"
        icon="⚡️"
        iconClassName="bg-seal/10"
        title={badges.mdx.title}
        description={badges.mdx.description}
        rotate={-1}
        translateY={badgeBottomY}
        className="bottom-6 left-10 sm:left-12"
        visibleFrom="lg"
      />
    </div>
  );
}
