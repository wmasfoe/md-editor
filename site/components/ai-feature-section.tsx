"use client";

import React, { useCallback, useState } from "react";
import { useI18n } from "../lib/i18n/context";
import { interpolate } from "../lib/parallax";

interface AiFeatureSectionProps {
  scrollY: number;
  prefersReducedMotion: boolean;
}

export function AiFeatureSection({ scrollY, prefersReducedMotion }: AiFeatureSectionProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  // 交互式行内幽灵文本模拟器 3 态机（待采纳 / 已采纳 / 已忽略）
  type AiStatus = "suggesting" | "accepted" | "dismissed";
  const [status, setStatus] = useState<AiStatus>("suggesting");
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  // 视差位移计算：滚动经过 AI 展区时整体微升与微透视缩放
  const sectionY = prefersReducedMotion ? 0 : interpolate(scrollY, [600, 1300], [40, -15]);
  const sectionScale = prefersReducedMotion ? 1 : interpolate(scrollY, [600, 1300], [0.97, 1.0]);

  // 下方 3 枚 Bento 特性卡片的大幅度交错视差 (Staggered Parallax Floating)
  const card0Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [45, -20]);
  const card1Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [15, -45]);
  const card2Y = prefersReducedMotion ? 0 : interpolate(scrollY, [750, 1450], [55, -15]);
  const cardOffsets = [card0Y, card1Y, card2Y];

  const handleAccept = useCallback(() => {
    setStatus("accepted");
  }, []);

  const handleDismiss = useCallback(() => {
    setStatus("dismissed");
  }, []);

  const handleReset = useCallback(() => {
    setStatus("suggesting");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        if (status === "suggesting") {
          setStatus("accepted");
        } else if (status === "dismissed") {
          setStatus("suggesting");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (status === "suggesting") {
          setStatus("dismissed");
        } else if (status === "accepted" || status === "dismissed") {
          setStatus("suggesting");
        }
      }
    },
    [status],
  );

  // 全局键盘监听：当鼠标悬停于演示卡片或卡片内部获取焦点时，无论光标在何处均响应 Tab 与 Esc
  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 若用户正聚焦在输入框、文本域或 CodeMirror 编辑器中，切勿截获
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest(".cm-editor")))
      ) {
        return;
      }

      if (isHovered || isFocused) {
        if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          if (status === "suggesting") {
            setStatus("accepted");
          } else if (status === "dismissed") {
            setStatus("suggesting");
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (status === "suggesting") {
            setStatus("dismissed");
          } else if (status === "accepted" || status === "dismissed") {
            setStatus("suggesting");
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
    };
  }, [isHovered, isFocused, status]);

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
          title: "非侵入行内续写",
          desc: "拒绝突兀弹窗与冗余对话侧栏。灵感化作淡雅幽灵文字，轻敲 Tab 瞬息采纳。",
          tag: "⇥ Tab to Accept",
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
          title: "Ambient Ghost Text",
          desc: "No distracting modals or sidebars. Thoughtful suggestions emerge inline, accepted via Tab.",
          tag: "⇥ Tab to Accept",
        },
        {
          icon: "🧠",
          title: "Full Context Awareness",
          desc: "Deeply attuned to your essay structure and tone, providing seamless prose transitions.",
          tag: "Context Aware",
        },
      ];

  return (
    <section
      aria-label={isZh ? "AI 智能赋能体验" : "Ambient AI Showcase"}
      className="relative mx-auto mt-20 max-w-5xl px-4 sm:mt-28 sm:px-8"
    >
      {/* 展区头部：优雅居中标题与徽标 */}
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft shadow-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span>{isZh ? "端侧智能 · 灵犀相契" : "AMBIENT LOCAL AI · IN-FLOW"}</span>
        </div>

        <h2 className="mt-4 font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
          {isZh ? "灵犀相通，润物无声" : "Ambient Intelligence, Whisper-Quiet"}
        </h2>

        <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
          {isZh
            ? "端侧小语言模型静默运行，无需联网。在你沉思停笔的瞬间，恰如其分地送上灵感延续。"
            : "Lightweight on-device models whisper inline suggestions the moment you pause, with zero cloud dependency."}
        </p>
      </div>

      {/* 核心舞台：交互式行内幽灵文本模拟器 */}
      <div
        style={{
          transform: `translate3d(0, ${sectionY}px, 0) scale(${sectionScale})`,
          willChange: "transform",
        }}
        className="mt-8 sm:mt-12"
      >
        <div
          ref={cardRef}
          tabIndex={0}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onMouseDown={() => {
            cardRef.current?.focus();
          }}
          onKeyDown={handleKeyDown}
          className={`group relative overflow-hidden rounded-3xl border bg-surface p-6 shadow-[0_24px_64px_-12px_rgba(20,18,15,0.1),0_0_0_1px_rgba(20,18,15,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all focus:outline-none sm:p-10 ${
            isHovered || isFocused
              ? "border-accent/60 ring-2 ring-accent/25"
              : "border-line-strong/80"
          }`}
        >
          {/* 顶部模拟状态条 */}
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-ink-soft">
                {isZh ? "本地端侧 SLM · 极速推理就绪" : "On-Device SLM · Ready"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {status === "accepted" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-600/20">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {isZh ? "已融入正文" : "Accepted"}
                </span>
              ) : status === "dismissed" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-soft px-2.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">
                  {isZh ? "已忽略建议" : "Dismissed"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/20">
                  {isZh ? "行内建议就绪" : "Suggestion Ready"}
                </span>
              )}
            </div>
          </div>

          {/* 沉浸式宣纸文本交互工作区 */}
          <div className="py-8 sm:py-10">
            <p className="text-lg leading-[1.85] text-ink sm:text-2xl sm:leading-[1.9]">
              <span>
                {isZh
                  ? "写作本是一场沉静的对话。"
                  : "Writing is a quiet conversation with oneself. "}
              </span>

              {/* 光标与幽灵文本 */}
              {status !== "accepted" && (
                <span
                  aria-hidden
                  className="inline-block h-5 w-[2px] translate-y-0.5 animate-pulse bg-ink align-baseline sm:h-6"
                />
              )}

              {status === "accepted" && (
                <span className="font-normal text-ink transition-all duration-300">
                  {isZh
                    ? "在宣纸方寸之间，任思绪流淌，重拾落笔成文的纯粹愉悦。"
                    : "Between quiet margins, thoughts crystallize into lasting words with pure focus."}
                </span>
              )}

              {status === "suggesting" && (
                <span
                  onClick={handleAccept}
                  title={isZh ? "点击或按 Tab 采纳续写" : "Click or press Tab to accept suggestion"}
                  className="italic text-ink/40 font-serif selection:bg-accent/20 cursor-pointer hover:text-ink/65 hover:underline decoration-accent/40 decoration-wavy underline-offset-4 transition-all duration-300"
                >
                  {isZh
                    ? "在宣纸方寸之间，任思绪流淌，重拾落笔成文的纯粹愉悦。"
                    : "Between quiet margins, thoughts crystallize into lasting words with pure focus."}
                </span>
              )}

              {status === "dismissed" && (
                <span
                  onClick={handleReset}
                  title={isZh ? "点击或按 Tab 重新获取建议" : "Click or press Tab to retry"}
                  className="cursor-pointer text-xs text-muted/60 italic hover:text-accent transition-colors ml-2"
                >
                  {isZh
                    ? "（建议已忽略，轻敲 Tab 重新唤起）"
                    : "(Suggestion dismissed. Press Tab to retry)"}
                </span>
              )}
            </p>
          </div>

          {/* 拟物 Keycap 交互控制面板 */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line/70 pt-5">
            <div className="flex items-center gap-2">
              {status === "suggesting" && (
                <>
                  <button
                    type="button"
                    onClick={handleAccept}
                    className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                  >
                    <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                      ⇥ Tab
                    </kbd>
                    <span>{isZh ? "采纳建议" : "Accept Suggestion"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-xs text-muted transition-colors hover:text-ink"
                  >
                    <kbd className="rounded-md border border-line/60 bg-surface-soft px-1.5 py-0.5 font-mono text-[10px]">
                      ⎋ Esc
                    </kbd>
                    <span>{isZh ? "忽略" : "Dismiss"}</span>
                  </button>
                </>
              )}

              {status === "accepted" && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                >
                  <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    ⎋ Esc
                  </kbd>
                  <span>{isZh ? "重置演示" : "Reset Demo"}</span>
                </button>
              )}

              {status === "dismissed" && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_0_rgba(20,18,15,0.08)] transition-all hover:bg-surface active:translate-y-[1px] active:shadow-none"
                >
                  <kbd className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    ⇥ Tab
                  </kbd>
                  <span>{isZh ? "重新获取建议" : "Re-trigger"}</span>
                </button>
              )}
            </div>

            <p
              className={`text-[11px] transition-colors duration-200 ${
                isHovered || isFocused ? "font-medium text-accent" : "text-muted"
              }`}
            >
              {isHovered || isFocused
                ? status === "suggesting"
                  ? isZh
                    ? "✨ 快捷键已就绪：轻敲 Tab 采纳建议，Esc 忽略"
                    : "✨ Shortcuts active: Press Tab to accept, Esc to dismiss"
                  : status === "accepted"
                    ? isZh
                      ? "✨ 已采纳：轻敲 Esc 随时重置演示"
                      : "✨ Accepted: Press Esc to reset demo"
                    : isZh
                      ? "💡 已忽略：轻敲 Tab 重新唤起行内灵感续写"
                      : "💡 Dismissed: Press Tab to re-trigger suggestion"
                : isZh
                  ? "💡 提示：将光标悬停于卡片或点击卡片，直接轻敲 Tab 采纳、Esc 忽略"
                  : "💡 Tip: Hover or click card, then press Tab to accept or Esc to dismiss"}
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
