"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createDocumentState, type DocumentState } from "@md-editor/editor-core";
import { useI18n } from "../lib/i18n/context";
import { MDX_SHOWCASE_SAMPLE } from "./showcase-samples";
import { SiteLiveEditor } from "./site-live-editor";

interface MdxWipeCanvasProps {
  sourceReveal: number;
  previewLabel: string;
  sourceLabel: string;
  filename: string;
}

function syncMarkdown(from: DocumentState, to: DocumentState) {
  const markdown = from.getSnapshot().markdown;
  if (markdown === to.getSnapshot().markdown) return;
  to.replaceDocument(
    {
      markdown,
      savedMarkdown: markdown,
      filePath: null,
      mode: to.getSnapshot().mode,
      // 同一篇文档的**内容同步**（一份内容同时展示在两种模式下）⇒ 必须保留阅读位置。
      // 不声明会回落 fail-safe `"different"`，让镜像面板在每次同步时被弹回顶部
      //（code-reviewer 复审 MEDIUM：本宿主在移除渲染层推断后漏声明）。
      replaceIntent: "same",
    },
    { kind: "command", commandId: "mdx.wipe.sync" },
  );
}

/**
 * 同一视窗内的原地擦除：右侧不透明源码层盖住左侧所见即所得。
 * 两份 DocumentState 各持一种模式，内容变更双向同步。
 */
export function MdxWipeCanvas({
  sourceReveal,
  previewLabel,
  sourceLabel,
  filename,
}: MdxWipeCanvasProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const initialMarkdown = isZh ? MDX_SHOWCASE_SAMPLE.markdownZh : MDX_SHOWCASE_SAMPLE.markdownEn;
  const samples = useMemo(() => [MDX_SHOWCASE_SAMPLE], []);
  const syncingRef = useRef(false);

  const [wysiwygDocument] = useState(() =>
    createDocumentState({
      markdown: initialMarkdown,
      mode: "wysiwyg",
    }),
  );
  const [sourceDocument] = useState(() =>
    createDocumentState({
      markdown: initialMarkdown,
      mode: "source",
    }),
  );

  useEffect(() => {
    const unsubscribers = [wysiwygDocument, sourceDocument].map((from, index) => {
      const to = index === 0 ? sourceDocument : wysiwygDocument;
      return from.subscribeTransitions((event) => {
        if (syncingRef.current) return;
        const kind = event.transition.kind;
        // 只跟用户编辑走；replaceDocument 同步写入会发出 document-replace，忽略以免回环
        if (kind !== "content") return;
        syncingRef.current = true;
        try {
          syncMarkdown(from, to);
        } finally {
          syncingRef.current = false;
        }
      });
    });
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sourceDocument, wysiwygDocument]);

  const [mobileMode, setMobileMode] = useState<"split" | "preview" | "source">("split");

  const effectiveReveal =
    mobileMode === "preview" ? 0.01 : mobileMode === "source" ? 100 : sourceReveal;

  const rightWidth = Math.min(Math.max(effectiveReveal, 0.5), 100);
  const leftWidth = 100 - rightWidth;

  return (
    <div className="relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-3xl border border-line-strong/80 bg-surface shadow-[0_24px_64px_-12px_rgba(20,18,15,0.12),0_0_0_1px_rgba(20,18,15,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface-soft/80 px-3 sm:px-4">
        <span className="truncate font-mono text-[11px] text-muted">{filename}</span>

        {/* 移动端模式快速切换胶囊 */}
        <div className="flex items-center gap-1.5 sm:hidden">
          <button
            type="button"
            onClick={() => setMobileMode((m) => (m === "preview" ? "split" : "preview"))}
            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
              mobileMode === "preview"
                ? "bg-surface font-semibold text-accent shadow-xs border border-line"
                : "text-muted hover:text-ink"
            }`}
          >
            {previewLabel}
          </button>
          <button
            type="button"
            onClick={() => setMobileMode((m) => (m === "source" ? "split" : "source"))}
            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
              mobileMode === "source"
                ? "bg-surface font-semibold text-seal shadow-xs border border-line"
                : "text-muted hover:text-ink"
            }`}
          >
            {sourceLabel}
          </button>
        </div>

        <span className="hidden text-[11px] text-muted sm:inline-flex sm:items-center">
          {previewLabel}
          <span className="mx-1.5 text-line-strong">→</span>
          {sourceLabel}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {leftWidth > 0.1 ? (
          <div
            className="absolute inset-y-0 left-0 z-0 overflow-hidden bg-surface"
            style={{ width: `${leftWidth}%`, contain: "paint" }}
          >
            <div className="h-full" style={{ width: `${(100 / leftWidth) * 100}%` }}>
              <SiteLiveEditor
                className="h-full"
                layout="document"
                mdxMode
                chrome={false}
                framed={false}
                samples={samples}
                documentState={wysiwygDocument}
                requestedMode="wysiwyg"
              />
            </div>
          </div>
        ) : null}

        {/* 不透明源码层从右侧盖住所见即所得，并可直接编辑 */}
        <div
          className="absolute inset-y-0 right-0 z-[1] overflow-hidden border-l border-line bg-surface"
          style={{ width: `${rightWidth}%` }}
        >
          <div className="h-full" style={{ width: `${(100 / rightWidth) * 100}%` }}>
            <SiteLiveEditor
              className="h-full"
              layout="document"
              mdxMode
              chrome={false}
              framed={false}
              samples={samples}
              documentState={sourceDocument}
              requestedMode="source"
            />
          </div>
        </div>

        <div
          className="pointer-events-none absolute top-0 bottom-0 z-[2] -ml-px"
          style={{ left: `${leftWidth}%` }}
        >
          <div className="h-full w-px bg-line-strong" />
          <span className="absolute top-3 right-full mr-2 whitespace-nowrap rounded-full border border-line bg-surface/95 px-2 py-0.5 text-[10px] font-medium text-ink-soft shadow-xs">
            {previewLabel}
          </span>
          <span className="absolute top-3 left-2 whitespace-nowrap rounded-full border border-line bg-surface/95 px-2 py-0.5 text-[10px] font-medium text-seal shadow-xs">
            {sourceLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
