"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createDocumentState, type DocumentState } from "@md-editor/editor-core";
import { CodeMirrorEditor, EditorUiProvider } from "@md-editor/editor-ui";
import { findCodeBlockLanguage } from "@md-editor/renderer-codemirror";
import { useI18n } from "../lib/i18n/context";
import { SHOWCASE_SAMPLES, type ShowcaseSample } from "./showcase-samples";

export const SiteLiveEditor = React.memo(function SiteLiveEditor() {
  const { locale } = useI18n();
  const isZh = locale === "zh";

  const [activeId, setActiveId] = useState<string>("focus");

  // 预热常用代码块语法解析器（ts, js, json, python, css, yaml），确保代码块高亮首帧瞬发
  useEffect(() => {
    ["ts", "js", "json", "python", "css", "yaml"].forEach((lang) => {
      findCodeBlockLanguage(lang)
        ?.load()
        .catch(() => {});
    });
  }, []);

  const initialMarkdown = useMemo(() => {
    const sample = SHOWCASE_SAMPLES.find((s) => s.id === "focus") ?? SHOWCASE_SAMPLES[0];
    return isZh ? sample.markdownZh : sample.markdownEn;
  }, [isZh]);

  // 纯内存文档状态：零本地存储，无需任何读写磁盘或 LocalStorage
  const [documentState] = useState<DocumentState>(() =>
    createDocumentState({
      markdown: initialMarkdown,
      mode: "wysiwyg",
    }),
  );

  const noopToast = useCallback(() => {}, []);

  const handleSelectSample = useCallback(
    (sample: ShowcaseSample) => {
      setActiveId(sample.id);
      const markdown = isZh ? sample.markdownZh : sample.markdownEn;
      documentState.replaceDocument(
        {
          markdown,
          savedMarkdown: markdown,
          filePath: null,
          mode: "wysiwyg",
        },
        { kind: "command", commandId: "sample.switch" },
      );
    },
    [documentState, isZh],
  );

  return (
    <EditorUiProvider markdown={initialMarkdown} showToast={noopToast}>
      <div
        style={
          {
            "--theme-surface": "#ffffff",
            "--theme-bg": "#faf9f6",
            "--theme-text": "#14120f",
            "--theme-title": "#14120f",
            "--theme-muted": "#7a736a",
            "--theme-border": "#e8e4dc",
            "--theme-primary": "#1f6feb",
            "--theme-primary-fill": "#1f6feb",
            "--theme-primary-soft": "rgba(31, 111, 235, 0.08)",
            "--theme-code": "#2e2a25",
            "--theme-code-bg": "#f5f3ec",
            "--theme-code-border": "#e4e0d7",
            "--theme-code-gutter-bg": "#ece8e0",
            "--theme-code-gutter-text": "#8a857a",
            "--theme-code-keyword": "#8c3f63",
            "--theme-code-string": "#466e2c",
            "--theme-code-comment": "#8a857a",
            "--theme-code-number": "#b45309",
            "--theme-code-tag": "#2a6877",
            "--theme-code-attribute": "#7c3aed",
            "--theme-code-variable": "#14120f",
            "--theme-code-accent": "#1f6feb",
            "--theme-font":
              'var(--font-inter), "LXGW WenKai", "LXGW WenKai Screen", "霞鹜文楷", system-ui, sans-serif',
            "--theme-mono-font":
              '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
            "--theme-editor-line-height": "1.75",
          } as React.CSSProperties
        }
        className="overflow-hidden rounded-3xl border border-line-strong/80 bg-surface shadow-[0_24px_64px_-12px_rgba(20,18,15,0.12),0_0_0_1px_rgba(20,18,15,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]"
      >
        {/* 双栏极简布局：左侧假迷你侧栏 + 右侧真实无标题栏编辑器 */}
        <div className="grid grid-cols-1 md:grid-cols-12 min-h-[300px] sm:min-h-[340px]">
          {/* 左侧工作区：假迷你侧栏（仅含常量文件切换） */}
          <aside className="hidden border-r border-line bg-canvas/60 p-3.5 md:col-span-3 md:flex md:flex-col md:justify-between">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {isZh ? "示例文档" : "SAMPLES"}
                </span>
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </div>

              <nav className="space-y-1.5">
                {SHOWCASE_SAMPLES.map((sample) => {
                  const isActive = sample.id === activeId;
                  const filename = isZh ? sample.filenameZh : sample.filenameEn;
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-all ${
                        isActive
                          ? "bg-surface font-medium text-ink shadow-xs ring-1 ring-black/5"
                          : "text-muted hover:bg-surface-soft/80 hover:text-ink"
                      }`}
                    >
                      <span className="text-sm transition-transform group-hover:scale-110">
                        {sample.icon}
                      </span>
                      <span className="truncate">{filename}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="mt-4 rounded-xl border border-line/70 bg-surface-soft/60 p-2.5 text-[11px] leading-relaxed text-muted">
              <span className="font-semibold text-ink-soft">
                {isZh ? "纯内存画布" : "In-Memory Canvas"}
              </span>
              <p className="mt-0.5">
                {isZh
                  ? "试着在右侧任意点击、敲入文字或修改内容，零本地存储负担。"
                  : "Type, edit, and explore typography directly on the right canvas."}
              </p>
            </div>
          </aside>

          {/* 右侧核心编辑画布：无标题栏，纯粹宣纸编辑体验 */}
          <div className="relative flex min-h-[300px] flex-col p-3.5 sm:min-h-[340px] sm:p-4 md:col-span-9 md:p-5">
            {/* 移动端横向迷你切换条（当侧栏隐藏时呈现） */}
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5 md:hidden">
              <span className="text-[11px] font-semibold text-muted">
                {isZh ? "示例文档:" : "Sample:"}
              </span>
              {SHOWCASE_SAMPLES.map((sample) => {
                const isActive = sample.id === activeId;
                const title = isZh ? sample.titleZh : sample.titleEn;
                return (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => handleSelectSample(sample)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                      isActive
                        ? "bg-surface-soft text-ink shadow-xs"
                        : "text-muted hover:text-ink-soft"
                    }`}
                  >
                    {sample.icon} {title}
                  </button>
                );
              })}
            </div>

            {/* 真实 CodeMirror WYSIWYG 编辑器 */}
            <div className="min-h-0 flex-1">
              <CodeMirrorEditor
                document={documentState}
                fontSize={15}
                codeBlockLineNumbers={true}
                className="site-live-editor-cm"
                openLinkTarget={(url) => {
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </EditorUiProvider>
  );
});
