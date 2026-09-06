"use client";

import React, { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import type { AiShowcaseEditorHandle, AiShowcaseFlowState } from "./ai-showcase-editor";

interface AiFeatureSectionProps {
  scrollY: number;
  prefersReducedMotion: boolean;
}

function AiEditorSkeleton({ isZh }: { isZh: boolean }) {
  return (
    <div className="flex min-h-[140px] sm:min-h-[160px] w-full items-center justify-center py-8 text-muted">
      <div className="flex items-center gap-2 text-xs">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span>{isZh ? "正在加载端侧 AI 画布..." : "Loading On-Device AI Canvas..."}</span>
      </div>
    </div>
  );
}

const DynamicAiShowcaseEditor = dynamic(
  () => import("./ai-showcase-editor").then((mod) => mod.AiShowcaseEditor),
  {
    ssr: false,
    loading: () => <AiEditorSkeleton isZh={true} />,
  },
);

export function AiFeatureSection({ scrollY, prefersReducedMotion }: AiFeatureSectionProps) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh";
  const aiText = t.aiShowcase;

  const editorRef = useRef<AiShowcaseEditorHandle | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // 两阶段流转状态
  const [aiState, setAiState] = useState<AiShowcaseFlowState>({
    stage: "grammar",
    grammarIndex: 0,
    grammarTotal: 3,
    continuationIndex: 0,
    continuationTotal: 3,
    isFinished: false,
    isDismissed: false,
  });

  const [isHovered, setIsHovered] = useState(false);

  // 视差位移计算：滚动经过 AI 展区时整体微升与微透视缩放
  const sectionY = prefersReducedMotion ? 0 : interpolate(scrollY, [600, 1300], [40, -15]);
  const sectionScale = prefersReducedMotion ? 1 : interpolate(scrollY, [600, 1300], [0.97, 1.0]);

  // 下方 3 枚 Bento 特性卡片的大幅度交错视差 (Staggered Parallax Floating)
  const card0Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [45, -20]);
  const card1Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [15, -45]);
  const card2Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [55, -15]);
  const cardOffsets = [card0Y, card1Y, card2Y];

  // 全局/卡片悬停键盘拦截：当悬停于卡片但焦点未处于 CodeMirror 内部时，将 Tab / Escape 无缝转入编辑器
  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".site-live-editor-cm")))
      ) {
        return;
      }

      const isTargetInAiCard = Boolean(
        target && cardRef.current && cardRef.current.contains(target),
      );
      const isCardActive = isHovered || isTargetInAiCard;

      if (!isCardActive) {
        return;
      }

      // 1. 若光标处于 CodeMirror 内部，未完成态下的 Tab 和 Esc 由 AiShowcaseEditor 内部捕获处理
      if (target?.closest(".site-ai-codemirror")) {
        return;
      }

      // 2. 若光标在卡片非编辑器区域（如头部或底部按钮区），将 Tab/Esc 转发给编辑器
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        editorRef.current?.focus();
        if (aiState.isDismissed) {
          editorRef.current?.retrigger();
        } else if (!aiState.isFinished) {
          editorRef.current?.accept();
        }
      } else if (e.key === "Escape") {
        if (!aiState.isFinished && !aiState.isDismissed) {
          e.preventDefault();
          e.stopPropagation();
          editorRef.current?.dismiss();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
    };
  }, [isHovered, aiState.isDismissed, aiState.isFinished]);

  const bentoItems = isZh
    ? [
        {
          icon: "🔒",
          title: "端侧本地直跑",
          desc: "完全离线可用，写作隐私与思考记录绝不出设备，断网环境亦能行云流水。",
          tag: "0 Cloud Latency",
        },
        {
          icon: "🎯",
          title: "先审校后续写 · 一气呵成",
          desc: "连续轻敲 Tab，从标点病句纠错自然过渡到灵犀续写，篇章落笔成章。",
          tag: "⇥ Flow In-Sync",
        },
        {
          icon: "🧠",
          title: "全篇脉络感知",
          desc: "深度感知上下文论述结构与行文文风，精准奉上契合语境的遣词造句与行文衔接。",
          tag: "Context Aware",
        },
      ]
    : [
        {
          icon: "🔒",
          title: "On-Device Local SLM",
          desc: "100% offline inference. Zero telemetry, zero cloud egress. Total privacy and speed.",
          tag: "0 Cloud Latency",
        },
        {
          icon: "🎯",
          title: "Polish & Continue in Flow",
          desc: "Press Tab continuously: flow seamlessly from grammar polish to inspired continuation.",
          tag: "⇥ Flow In-Sync",
        },
        {
          icon: "🧠",
          title: "Full Context Awareness",
          desc: "Deeply attuned to your essay structure and tone, providing seamless prose transitions.",
          tag: "Context Aware",
        },
      ];

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // 阻止浏览器将 DOM 焦点转移给头部元素，保证 CodeMirror 编辑器捕获键盘
    e.preventDefault();
    editorRef.current?.focus();
  }, []);

  return (
    <section
      aria-label={isZh ? "AI 智能赋能体验" : "Ambient AI Showcase"}
      className="relative mx-auto mt-20 max-w-5xl px-4 sm:mt-28 sm:px-8"
    >
      {/* 展区头部：优雅居中标题与徽标 */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span>{aiText.sectionBadge}</span>
        </div>

        <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
          {aiText.sectionTitle}
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
          {aiText.sectionSubtitle}
        </p>
      </div>

      {/* 核心舞台：真实 @md-editor/editor-ui 承载的交互式 AI 模拟器 */}
      <div
        style={{
          transform: `translate3d(0, ${sectionY}px, 0) scale(${sectionScale})`,
          willChange: "transform",
        }}
        className="mt-8 sm:mt-12"
      >
        <div
          ref={cardRef}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`group relative overflow-hidden rounded-3xl border bg-surface p-6 shadow-[0_24px_64px_-12px_rgba(20,18,15,0.1),0_0_0_1px_rgba(20,18,15,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all sm:p-8 ${
            isHovered ? "border-accent/60 ring-2 ring-accent/25" : "border-line-strong/80"
          }`}
        >
          {/* 顶部状态与两阶段流转链：点红框区域自动引导焦点至 CodeMirror，tabIndex={-1} 彻底杜绝切焦 */}
          <div
            onMouseDown={handleHeaderMouseDown}
            className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between"
          >
            {/* 左侧：SLM 就绪指示与两阶段直达胶囊 */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-medium text-ink-soft">{aiText.statusSlmReady}</span>
              </div>

              {/* 连贯流阶段指示条：tabIndex={-1} 阻止键盘 Tab 切入按钮 */}
              <div
                role="tablist"
                aria-label="AI Sequential Stages"
                className="inline-flex items-center rounded-xl border border-line bg-surface-soft/80 p-0.5 shadow-inner"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.preventDefault();
                    editorRef.current?.jumpToStage("grammar");
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                    aiState.stage === "grammar"
                      ? "bg-surface text-ink shadow-xs border border-line-strong/60"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  <span>{aiText.tabGrammar}</span>
                  <span className="ml-1 font-mono text-[10px] opacity-70">
                    {aiState.stage === "grammar"
                      ? `(${Math.min(aiState.grammarIndex + 1, aiState.grammarTotal)}/${aiState.grammarTotal})`
                      : "✓"}
                  </span>
                </button>

                <span className="select-none px-1 text-xs text-muted/40">→</span>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.preventDefault();
                    editorRef.current?.jumpToStage("continuation");
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                    aiState.stage === "continuation" || aiState.stage === "completed"
                      ? "bg-surface text-ink shadow-xs border border-line-strong/60"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  <span>{aiText.tabContinuation}</span>
                  <span className="ml-1 font-mono text-[10px] opacity-70">
                    {aiState.stage === "continuation"
                      ? `(${Math.min(aiState.continuationIndex + 1, aiState.continuationTotal)}/${aiState.continuationTotal})`
                      : aiState.stage === "completed"
                        ? "✓"
                        : ""}
                  </span>
                </button>
              </div>
            </div>

            {/* 右侧：状态指示徽标与步骤小圆点 */}
            <div className="flex items-center gap-3">
              {/* 步骤进度指示 */}
              <div className="flex items-center gap-1.5">
                {aiState.stage === "grammar" &&
                  Array.from({ length: aiState.grammarTotal }).map((_, idx) => {
                    const isDone = idx < aiState.grammarIndex;
                    const isCurrent = idx === aiState.grammarIndex;
                    return (
                      <span
                        key={idx}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          isDone
                            ? "w-4 bg-accent"
                            : isCurrent
                              ? "w-4 bg-accent/60 animate-pulse"
                              : "w-1.5 bg-line-strong/60"
                        }`}
                      />
                    );
                  })}

                {aiState.stage === "continuation" &&
                  Array.from({ length: aiState.continuationTotal }).map((_, idx) => {
                    const isDone = idx < aiState.continuationIndex;
                    const isCurrent = idx === aiState.continuationIndex;
                    return (
                      <span
                        key={idx}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          isDone
                            ? "w-4 bg-accent"
                            : isCurrent
                              ? "w-4 bg-accent/60 animate-pulse"
                              : "w-1.5 bg-line-strong/60"
                        }`}
                      />
                    );
                  })}

                {aiState.stage === "completed" && (
                  <span className="h-1.5 w-6 rounded-full bg-emerald-500 transition-all duration-300" />
                )}
              </div>

              {/* 状态 Badge */}
              {aiState.isFinished ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {aiText.statusAllCompleted}
                </span>
              ) : aiState.isDismissed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-soft px-2.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">
                  {aiText.statusDismissed}
                </span>
              ) : aiState.stage === "grammar" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/20">
                  {aiText.statusGrammarReady} (
                  {Math.min(aiState.grammarIndex + 1, aiState.grammarTotal)}/{aiState.grammarTotal})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20">
                  {aiText.statusContinuationReady} (
                  {Math.min(aiState.continuationIndex + 1, aiState.continuationTotal)}/
                  {aiState.continuationTotal})
                </span>
              )}
            </div>
          </div>

          {/* 沉浸式宣纸文本交互工作区：真实 CodeMirror WYSIWYG 编辑器 */}
          <div className="py-6 sm:py-8" onMouseDown={() => editorRef.current?.focus()}>
            <DynamicAiShowcaseEditor ref={editorRef} isZh={isZh} onStateChange={setAiState} />
          </div>

          {/* 拟物 Keycap 交互控制面板：所有按钮设置 tabIndex={-1}，避免抢占 Tab 键 */}
          <div
            onMouseDown={(e) => {
              // 阻止点击底部按钮栏时移出 CodeMirror 焦点
              e.preventDefault();
            }}
            className="flex flex-wrap items-center justify-between gap-4 border-t border-line/70 pt-5"
          >
            <div className="flex items-center gap-2">
              {!aiState.isFinished && !aiState.isDismissed ? (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => editorRef.current?.accept()}
                    className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                  >
                    <kbd
                      tabIndex={-1}
                      className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      ⇥ Tab
                    </kbd>
                    <span>
                      {aiState.stage === "grammar"
                        ? `${aiText.acceptButton} (${Math.min(aiState.grammarIndex + 1, aiState.grammarTotal)}/${aiState.grammarTotal})`
                        : `${aiText.acceptButton} (${Math.min(aiState.continuationIndex + 1, aiState.continuationTotal)}/${aiState.continuationTotal})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => editorRef.current?.dismiss()}
                    className="inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-xs text-muted transition-colors hover:text-ink"
                  >
                    <kbd
                      tabIndex={-1}
                      className="rounded-md border border-line/60 bg-surface-soft px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      ⎋ Esc
                    </kbd>
                    <span>{aiText.dismissButton}</span>
                  </button>
                </>
              ) : aiState.isDismissed ? (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => editorRef.current?.retrigger()}
                    className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                  >
                    <kbd
                      tabIndex={-1}
                      className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      ⇥ Tab
                    </kbd>
                    <span>{aiText.retriggerButton}</span>
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => editorRef.current?.reset()}
                    className="inline-flex items-center gap-2 rounded-xl border border-line/60 bg-surface-soft px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-ink hover:bg-surface"
                  >
                    <span>{aiText.resetButton}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => editorRef.current?.reset()}
                  className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                >
                  <span>{aiText.resetButton}</span>
                </button>
              )}
            </div>

            {/* 辅助提示 */}
            <p
              className={`text-[11px] transition-colors duration-200 ${
                isHovered ? "font-medium text-accent" : "text-muted"
              }`}
            >
              {aiState.isDismissed
                ? aiText.tipDismissed
                : aiState.isFinished
                  ? aiText.tipCompleted
                  : isHovered
                    ? aiState.stage === "grammar"
                      ? isZh
                        ? "✨ 阶段 ① 审校中：轻敲 Tab 逐项修正，Esc 跳过当前项"
                        : "✨ Phase 1 Polish: Press Tab to accept fix, Esc to skip"
                      : isZh
                        ? "✨ 阶段 ② 续写中：轻敲 Tab 逐段融入，体验行云流水"
                        : "✨ Phase 2 Continuation: Press Tab to accept inspired ghost text"
                    : isZh
                      ? "💡 提示：将手放在键盘上，一路轻敲 Tab 即可完成从「草稿纠错」到「落笔成章」的全过程"
                      : "💡 Tip: Rest hands on keyboard: press Tab continuously to polish & continue prose"}
            </p>
          </div>
        </div>
      </div>

      {/* 3 枚 Apple 悬浮交错 Bento 卡片 */}
      <div className="mt-8 grid gap-5 sm:grid-cols-3 sm:gap-6 sm:mt-12">
        {bentoItems.map((item, idx) => (
          <div
            key={item.title}
            style={{
              transform: `translate3d(0, ${cardOffsets[idx] ?? 0}px, 0)`,
              willChange: "transform",
            }}
            className="group relative flex flex-col justify-between rounded-3xl border border-line bg-surface p-6 shadow-[0_4px_20px_rgba(20,18,15,0.03)] transition-all duration-300 hover:border-line-strong hover:shadow-[0_12px_32px_rgba(20,18,15,0.08)] sm:p-8"
          >
            <div>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-surface-soft/80 text-lg shadow-xs">
                {item.icon}
              </div>
              <h3 className="text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent sm:text-lg">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted transition-colors group-hover:text-ink-soft sm:text-[15px]">
                {item.desc}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-line/50 pt-4 text-[11px] text-muted">
              <span>{isZh ? "体验特性" : "Capability"}</span>
              <span className="font-mono text-ink/70">{item.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
