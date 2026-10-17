import React, { useMemo, useEffect, useRef } from "react";
import { renderStaticHtml } from "@md-editor/compiler";
import { ensureKatexStylesheet } from "@md-editor/syntax-plugins";
import { hydrateMermaid, extractOutline } from "../lib/plugin-renderer.ts";
import { bridge } from "../bridge/index.ts";

export interface ReaderCanvasProps {
  content: string;
  onEnterEdit: () => void;
  isDark?: boolean;
}

export const ReaderCanvas: React.FC<ReaderCanvasProps> = ({ content, onEnterEdit, isDark }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 使用 @md-editor/compiler 纯静态 headless 引擎渲染高保真 HTML
  const { html, outline } = useMemo(() => {
    const result = renderStaticHtml(content);
    const extractedOutline = extractOutline(content);

    return {
      html: result.html,
      outline: extractedOutline,
    };
  }, [content]);

  // 阅读器把 compiler 输出的 HTML 片段注入宿主 DOM（片段不含内联样式），
  // 因此这里显式索取 KaTeX 官方样式；样式唯一来源在 @md-editor/syntax-plugins。
  useEffect(() => {
    void ensureKatexStylesheet();
  }, []);

  // 大纲解析完成后，上报给原生端（供 iOS / Android 原生大纲侧边栏使用）
  useEffect(() => {
    bridge.notifyOutline(outline);
  }, [outline]);

  // 水合渲染 Mermaid 图表为矢量 SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const dark = isDark ?? document.documentElement.classList.contains("dark");
    void hydrateMermaid(containerRef.current, dark);
  }, [content, html, isDark]);

  // 处理双击就地激活编辑
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    bridge.triggerHaptic("selection");
    onEnterEdit();
  };

  return (
    <div
      ref={containerRef}
      className="reader-container min-h-screen px-4 pt-4 pb-24 text-neutral-800 dark:text-neutral-200 transition-colors"
      onDoubleClick={handleDoubleClick}
    >
      <article
        className="markdown-body mx-auto max-w-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
