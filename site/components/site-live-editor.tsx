"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentState,
  type EditorMode,
} from "@md-editor/editor-core";
import {
  CodeMirrorEditor,
  EditorUiProvider,
  type CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import { findCodeBlockLanguage, type MarkdownSyntaxPlugin } from "@md-editor/renderer-codemirror";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-component-registry";
import { officialMdxPlugins } from "@md-editor/mdx-plugins/metadata";
import { useI18n } from "../lib/i18n/context";
import { SHOWCASE_SAMPLES, type ShowcaseSample } from "./showcase-samples";

export interface SiteLiveEditorProps {
  className?: string;
  /** 外部注入的文档状态；用于 MDX 擦除层左右实时同步 */
  documentState?: DocumentState;
  samples?: readonly ShowcaseSample[];
  initialSampleId?: string;
  /** 大写 JSX 标签按 MDX 组件解析 */
  mdxMode?: boolean;
  /**
   * 由滚动场景驱动的目标模式。变化时走 editor-core 的 mode switch，
   * 在同一份文档上切换所见即所得 / 源码，而不是另开一栏。
   */
  requestedMode?: EditorMode;
  /** workspace：假侧栏；document：仅画布，适合 MDX 源码切换演示 */
  layout?: "workspace" | "document";
  modeLabel?: string;
  /** document 布局下是否渲染文件名顶栏 */
  chrome?: boolean;
  /** 是否带外层卡片描边；擦除层叠时由外框统一承担 */
  framed?: boolean;
  /** 可选语法扩展插件列表；缺省时默认搭载全部官方语法插件 */
  plugins?: readonly MarkdownSyntaxPlugin[];
}

/** 官网展示编辑器所挂载的全部官方语法扩展插件（高亮、容器指令、LaTeX 数学公式与 Mermaid 图表） */
const SITE_SYNTAX_PLUGINS: readonly MarkdownSyntaxPlugin[] = Object.freeze([
  highlightPlugin,
  containerDirectivePlugin,
  mathPlugin,
  mermaidPlugin,
]);

/** 官方 MDX 内置组件注册表（支持 Callout 等组件在画布中以排版渲染） */
const SITE_MDX_REGISTRY = createBuiltInMdxRegistry(officialMdxPlugins);

const EDITOR_THEME = {
  "--theme-surface": "#ffffff",
  "--theme-bg": "#faf9f6",
  "--theme-text": "#14120f",
  "--theme-title": "#14120f",
  "--theme-muted": "#7a736a",
  "--theme-border": "#e8e4dc",
  "--theme-primary": "#1f6feb",
  "--theme-primary-fill": "#1f6feb",
  "--theme-primary-soft": "rgba(31, 111, 235, 0.08)",
  "--theme-highlight-bg": "rgba(253, 224, 71, 0.42)",
  "--theme-highlight-text": "#14120f",
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
  "--theme-mono-font": '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
  "--theme-editor-line-height": "1.75",
} as React.CSSProperties;

export const SiteLiveEditor = React.memo(function SiteLiveEditor({
  className,
  documentState: documentStateProp,
  samples = SHOWCASE_SAMPLES,
  initialSampleId,
  mdxMode = false,
  requestedMode,
  layout = "workspace",
  modeLabel,
  chrome = true,
  framed = true,
  plugins: userPlugins,
}: SiteLiveEditorProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh";
  const defaultId = initialSampleId ?? samples[0]?.id ?? "focus";
  const [activeId, setActiveId] = useState<string>(defaultId);
  const [liveMode, setLiveMode] = useState<EditorMode>(requestedMode ?? "wysiwyg");
  const portsRef = useRef<CodeMirrorEditorPorts | null>(null);
  const [portsGeneration, setPortsGeneration] = useState(0);

  // 默认挂载所有官方语法插件（高亮、容器、公式、Mermaid），支持外部灵活重载
  const activePlugins = useMemo(() => userPlugins ?? SITE_SYNTAX_PLUGINS, [userPlugins]);

  useEffect(() => {
    ["ts", "js", "json", "python", "css", "yaml"].forEach((lang) => {
      findCodeBlockLanguage(lang)
        ?.load()
        .catch(() => {});
    });
  }, []);

  const initialMarkdown = useMemo(() => {
    const sample = samples.find((item) => item.id === defaultId) ?? samples[0];
    return isZh ? sample.markdownZh : sample.markdownEn;
  }, [defaultId, isZh, samples]);

  const [ownedDocument] = useState<DocumentState>(() =>
    createDocumentState({
      markdown: initialMarkdown,
      mode: requestedMode ?? "wysiwyg",
    }),
  );
  const documentState = documentStateProp ?? ownedDocument;

  const noopToast = useCallback(() => {}, []);

  const applyRequestedMode = useCallback(
    (nextMode: EditorMode) => {
      const current = documentState.getSnapshot().mode;
      if (current === nextMode) {
        setLiveMode(nextMode);
        return;
      }
      const ports = portsRef.current;
      if (!ports) {
        setLiveMode(nextMode);
        return;
      }
      const result = switchEditorModeSafely(documentState, nextMode, {
        renderer: ports.mode,
        origin: { kind: "command", commandId: "view.toggleSource" },
      });
      if (result.ok) {
        setLiveMode(nextMode);
      }
    },
    [documentState],
  );

  useEffect(() => {
    if (!requestedMode) return;
    applyRequestedMode(requestedMode);
  }, [applyRequestedMode, requestedMode, portsGeneration]);

  const handleSelectSample = useCallback(
    (sample: ShowcaseSample) => {
      setActiveId(sample.id);
      const markdown = isZh ? sample.markdownZh : sample.markdownEn;
      const mode = requestedMode ?? documentState.getSnapshot().mode;
      documentState.replaceDocument(
        {
          markdown,
          savedMarkdown: markdown,
          filePath: null,
          mode,
        },
        { kind: "command", commandId: "sample.switch" },
      );
    },
    [documentState, isZh, requestedMode],
  );

  const activeSample = samples.find((item) => item.id === activeId) ?? samples[0];
  const filename = isZh ? activeSample.filenameZh : activeSample.filenameEn;
  const resolvedModeLabel =
    modeLabel ?? (liveMode === "source" ? (isZh ? "源码" : "Source") : "WYSIWYG");

  return (
    <EditorUiProvider markdown={initialMarkdown} showToast={noopToast}>
      <div
        style={EDITOR_THEME}
        className={[
          framed
            ? "overflow-hidden rounded-3xl border border-line-strong/80 bg-surface shadow-[0_24px_64px_-12px_rgba(20,18,15,0.12),0_0_0_1px_rgba(20,18,15,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]"
            : "h-full overflow-hidden bg-surface",
          className ?? "",
        ].join(" ")}
      >
        {layout === "document" ? (
          <div className="flex h-full min-h-[280px] flex-col">
            {chrome ? (
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface-soft/80 px-4">
                <span className="truncate font-mono text-[11px] text-muted">{filename}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft shadow-xs">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${liveMode === "source" ? "bg-seal" : "bg-accent"}`}
                  />
                  <span>{resolvedModeLabel}</span>
                </span>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 p-3.5 sm:p-4">
              <CodeMirrorEditor
                document={documentState}
                plugins={activePlugins}
                fontSize={15}
                codeBlockLineNumbers={true}
                mdxMode={mdxMode}
                mdxComponents={mdxMode ? SITE_MDX_REGISTRY : undefined}
                className="site-live-editor-cm"
                onRendererPortsChange={(ports) => {
                  const wasEmpty = portsRef.current === null;
                  portsRef.current = ports;
                  if (wasEmpty && ports) {
                    setPortsGeneration((generation) => generation + 1);
                  }
                }}
                openLinkTarget={(url) => {
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              />
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-[280px] grid-cols-1 md:grid-cols-12">
            <aside className="hidden border-r border-line bg-canvas/60 p-3.5 md:col-span-3 md:flex md:flex-col md:justify-between">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {isZh ? "示例文档" : "SAMPLES"}
                  </span>
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </div>

                <nav className="space-y-1.5">
                  {samples.map((sample) => {
                    const isActive = sample.id === activeId;
                    const sampleName = isZh ? sample.filenameZh : sample.filenameEn;
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
                        <span className="truncate">{sampleName}</span>
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

            <div className="relative flex min-h-[280px] flex-col p-3.5 sm:p-4 md:col-span-9 md:p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5 md:hidden">
                <span className="text-[11px] font-semibold text-muted">
                  {isZh ? "示例文档:" : "Sample:"}
                </span>
                {samples.map((sample) => {
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

              <div className="min-h-0 flex-1">
                <CodeMirrorEditor
                  document={documentState}
                  plugins={activePlugins}
                  fontSize={15}
                  codeBlockLineNumbers={true}
                  mdxMode={mdxMode}
                  mdxComponents={mdxMode ? SITE_MDX_REGISTRY : undefined}
                  className="site-live-editor-cm"
                  onRendererPortsChange={(ports) => {
                    const wasEmpty = portsRef.current === null;
                    portsRef.current = ports;
                    if (wasEmpty && ports) {
                      setPortsGeneration((generation) => generation + 1);
                    }
                  }}
                  openLinkTarget={(url) => {
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </EditorUiProvider>
  );
});
