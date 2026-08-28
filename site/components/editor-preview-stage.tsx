"use client";

import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";

interface EditorPreviewStageProps {
  scrollY: number;
  prefersReducedMotion: boolean;
}

/**
 * Apple 官网级产品舞台（Editor Showcase Stage）:
 * 1. 3D 透视展开展现：从顶部滚动时，窗口从带俯仰视角 (rotateX: 14deg) 平滑展开至正视平面 (rotateX: 0deg)；
 * 2. 窗口尺寸与景深投影：随着滚动微缩放 (scale: 0.92 -> 1.02) 并加深环境漫反射投影；
 * 3. 浮动视差挂件 (Satellite Badges)：3 枚功能徽标以大幅度差速在窗口四周浮动位移；
 * 4. 编辑器实例文档：以霞鹜文楷呈现逼真的 Markdown / MDX 写作与代码高亮排版。
 */
export function EditorPreviewStage({
  scrollY,
  prefersReducedMotion,
}: EditorPreviewStageProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  // 3D 旋转角度插值：从 14deg 逐渐平展至 0deg
  const rotateX = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 450], [14, 0]);
  // 缩放插值：从 0.92 逐渐放大至 1.01
  const scale = prefersReducedMotion ? 1 : interpolate(scrollY, [0, 450], [0.92, 1.01]);
  // 窗口垂直位移
  const translateY = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 450], [20, -35]);

  // 浮动挂件大幅度视差位移
  const badgeLeftY = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 600], [-30, 70]);
  const badgeRightY = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 600], [50, -60]);
  const badgeBottomY = prefersReducedMotion ? 0 : interpolate(scrollY, [0, 600], [-10, 45]);

  return (
    <div
      className="relative mx-auto mt-12 w-full max-w-5xl px-4 sm:mt-16 sm:px-6"
      style={{ perspective: "1200px" }}
    >
      {/* 浮动视差挂件 1：左上角本地优先 */}
      <div
        aria-hidden
        style={{
          transform: `translate3d(0, ${badgeLeftY}px, 0) rotate(-2deg)`,
          willChange: "transform",
        }}
        className="pointer-events-none absolute -left-2 top-8 z-20 hidden rounded-2xl border border-line-strong/80 bg-surface/90 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(20,18,15,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-transform duration-100 ease-out md:flex md:items-center md:gap-2.5"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/10 text-sm">
          📁
        </span>
        <div>
          <p className="text-xs font-semibold text-ink">
            {isZh ? "本地优先" : "Local-First"}
          </p>
          <p className="text-[11px] text-muted">
            {isZh ? "磁盘直读，零云依赖" : "Saved on disk, zero cloud"}
          </p>
        </div>
      </div>

      {/* 浮动视差挂件 2：右上角 MDX 实时组件 */}
      <div
        aria-hidden
        style={{
          transform: `translate3d(0, ${badgeRightY}px, 0) rotate(2.5deg)`,
          willChange: "transform",
        }}
        className="pointer-events-none absolute -right-2 top-24 z-20 hidden rounded-2xl border border-line-strong/80 bg-surface/90 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(20,18,15,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-transform duration-100 ease-out md:flex md:items-center md:gap-2.5"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-blot/10 text-sm">
          ⚡️
        </span>
        <div>
          <p className="text-xs font-semibold text-ink">
            {isZh ? "MDX / 所见即所得" : "MDX & WYSIWYG"}
          </p>
          <p className="text-[11px] text-muted">
            {isZh ? "文字与组件同屏排版" : "Unified writing canvas"}
          </p>
        </div>
      </div>

      {/* 浮动视差挂件 3：左下角性能与无损 */}
      <div
        aria-hidden
        style={{
          transform: `translate3d(0, ${badgeBottomY}px, 0) rotate(-1deg)`,
          willChange: "transform",
        }}
        className="pointer-events-none absolute bottom-6 left-12 z-20 hidden rounded-2xl border border-line-strong/80 bg-surface/90 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(20,18,15,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-transform duration-100 ease-out lg:flex lg:items-center lg:gap-2.5"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-seal/10 text-sm">
          ✒️
        </span>
        <div>
          <p className="text-xs font-semibold text-ink">
            {isZh ? "霞鹜文楷排版" : "Wenkai Typography"}
          </p>
          <p className="text-[11px] text-muted">
            {isZh ? "沉浸式中文书写质感" : "Tailored for long-form prose"}
          </p>
        </div>
      </div>

      {/* 主应用视窗 Mockup */}
      <div
        style={{
          transform: `rotateX(${rotateX}deg) scale(${scale}) translate3d(0, ${translateY}px, 0)`,
          transformOrigin: "center top",
          willChange: "transform",
        }}
        className="overflow-hidden rounded-2xl border border-line-strong/80 bg-surface shadow-[0_24px_64px_-12px_rgba(20,18,15,0.16),0_0_0_1px_rgba(20,18,15,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] transition-transform duration-75 ease-out"
      >
        {/* macOS 风格红绿灯标题栏 */}
        <div className="flex h-10 items-center justify-between border-b border-line bg-surface-soft/80 px-4 backdrop-blur-md">
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
          {/* 左侧工作区文件树 */}
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

          {/* 右侧核心编辑画布 */}
          <div className="p-6 md:col-span-9 md:p-8">
            <div className="prose max-w-none text-ink">
              <h1 className="font-sans text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {isZh ? "纸上烟云，笔下惊鸿" : "Crafting Words with Precision"}
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

              {/* 语法高亮代码块演示 */}
              <div className="my-4 overflow-hidden rounded-xl border border-line bg-surface-soft/80 p-3 font-mono text-[12px] leading-relaxed text-ink-soft shadow-xs sm:text-[13px]">
                <div className="flex items-center justify-between pb-2 text-[11px] text-muted">
                  <span>article.mdx</span>
                  <span className="text-accent">Live Preview</span>
                </div>
                <div className="border-t border-line/60 pt-2 text-ink">
                  <span className="text-accent">export const</span> meta = &#123; author: <span className="text-seal">&quot;Inkpoint&quot;</span> &#125;;
                  <br />
                  <span className="text-muted">&#60;</span>
                  <span className="text-blot font-semibold">Callout</span>
                  <span className="text-muted">&#62;</span>
                  {isZh ? " 极简、本地、专注于长文排版。" : " Distraction-free, local-first typography."}
                  <span className="text-muted">&#60;/</span>
                  <span className="text-blot font-semibold">Callout</span>
                  <span className="text-muted">&#62;</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
