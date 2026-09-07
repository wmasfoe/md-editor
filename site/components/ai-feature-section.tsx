"use client";

import React, { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";
import type { AiShowcaseEditorHandle, AiShowcaseFlowState } from "./ai-showcase-editor";
import { PinnedScene } from "./pinned-scene";

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

function AutoFocusWhenActive({ active, onActivate }: { active: boolean; onActivate: () => void }) {
  React.useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => onActivate());
    return () => window.cancelAnimationFrame(frame);
  }, [active, onActivate]);
  return null;
}

function AiTabHintBadge({
  active,
  prefersReducedMotion,
  label,
}: {
  active: boolean;
  prefersReducedMotion: boolean;
  label: string;
}) {
  const [visible, setVisible] = useState(false);

  React.useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    if (prefersReducedMotion) {
      setVisible(true);
      return;
    }
    // 先让区块站稳，再挤出提示，变成一次可被注意到的动作
    const id = window.setTimeout(() => setVisible(true), 920);
    return () => window.clearTimeout(id);
  }, [active, prefersReducedMotion]);

  return (
    <div
      className={`ai-tab-hint absolute top-0 left-1/2 z-20 ${visible ? "is-visible" : ""}`}
      aria-hidden={!visible}
    >
      <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-[0_10px_28px_rgba(20,18,15,0.14),inset_0_1px_0_rgba(255,255,255,0.95)]">
        <kbd className="ai-tab-hint-key">
          <span className="ai-tab-hint-key-cap">Tab</span>
        </kbd>
        <span>{label}</span>
      </p>
    </div>
  );
}

export function AiFeatureSection() {
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
  const isActiveRef = useRef(false);

  const focusEditor = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  // 当前 AI 区块盖住视口时即可 Tab，不必 hover / 点击
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
      const sceneReady = isActiveRef.current;
      if (!sceneReady && !isHovered && !isTargetInAiCard) {
        return;
      }

      // 焦点已在 CodeMirror 内时，Tab / Esc 由编辑器自己处理，避免重复采纳
      if (target?.closest(".site-ai-codemirror")) {
        return;
      }

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
    <PinnedScene
      id="ai"
      ariaLabel={isZh ? "AI 智能赋能体验" : "Ambient AI Showcase"}
      heightVh={200}
      frameClassName="bg-canvas z-[3]"
    >
      {({ progress, isActive, prefersReducedMotion }) => {
        isActiveRef.current = isActive;
        const headerOpacity = prefersReducedMotion
          ? 1
          : interpolate(progress, [0, 0.14], [0.78, 1]);
        const headerY = prefersReducedMotion ? 0 : interpolate(progress, [0, 0.16], [14, 0]);
        const cardIndex = prefersReducedMotion
          ? 0
          : Math.min(2, Math.floor(interpolate(progress, [0.08, 0.92], [0, 2.999])));
        const tabReady = isActive || isHovered;

        return (
          <div className="mx-auto flex h-full max-w-5xl flex-col px-4 pb-4 pt-14 sm:px-8 sm:pb-6 sm:pt-16">
            <AutoFocusWhenActive active={isActive} onActivate={focusEditor} />
            <div
              style={{
                opacity: headerOpacity,
                transform: `translate3d(0, ${headerY}px, 0)`,
              }}
              className="mx-auto max-w-2xl shrink-0 text-center"
            >
              <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                <span>{aiText.sectionBadge}</span>
              </div>

              <h2 className="mt-3 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
                {aiText.sectionTitle}
              </h2>

              <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
                {aiText.sectionSubtitle}
              </p>
            </div>

            <div className="relative mt-4 shrink-0">
              {bentoItems.map((item, idx) => {
                const visible = idx === cardIndex;
                return (
                  <div
                    key={item.title}
                    className={
                      visible ? "relative" : "pointer-events-none absolute inset-x-0 top-0"
                    }
                    style={{
                      opacity: visible ? 1 : 0,
                      transform: visible
                        ? "translate3d(0, 0, 0) scale(1)"
                        : "translate3d(36px, 0, 0) scale(0.96)",
                      transition:
                        "opacity 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                    aria-hidden={!visible}
                  >
                    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_4px_16px_rgba(20,18,15,0.03)]">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-soft/80 text-base">
                        {item.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <h3 className="text-sm font-semibold tracking-tight text-ink">
                            {item.title}
                          </h3>
                          <span className="font-mono text-[10px] text-ink/55">{item.tag}</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="relative mt-3 min-h-0 flex-1 sm:mt-4">
              <AiTabHintBadge
                active={isActive}
                prefersReducedMotion={prefersReducedMotion}
                label={aiText.tabHint}
              />
              <div
                ref={cardRef}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={`group relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-surface p-5 shadow-[0_24px_64px_-12px_rgba(20,18,15,0.1),0_0_0_1px_rgba(20,18,15,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all sm:p-6 ${
                  tabReady ? "border-line-strong ring-1 ring-ink/8" : "border-line-strong/80"
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
                      <span className="text-xs font-medium text-ink-soft">
                        {aiText.statusSlmReady}
                      </span>
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
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
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
                        {Math.min(aiState.grammarIndex + 1, aiState.grammarTotal)}/
                        {aiState.grammarTotal})
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
                <div
                  className="min-h-0 flex-1 overflow-hidden py-4 sm:py-5"
                  onMouseDown={() => editorRef.current?.focus()}
                >
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
                      tabReady ? "font-medium text-accent" : "text-muted"
                    }`}
                  >
                    {aiState.isDismissed
                      ? aiText.tipDismissed
                      : aiState.isFinished
                        ? aiText.tipCompleted
                        : tabReady
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
          </div>
        );
      }}
    </PinnedScene>
  );
}
