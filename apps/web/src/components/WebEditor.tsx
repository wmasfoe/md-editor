import React, { useCallback, useMemo } from "react";
import { CodeMirrorEditor, type CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import type { DocumentState } from "@md-editor/editor-core";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-component-registry";
import { officialMdxPlugins } from "@md-editor/mdx-plugins/metadata";
import type { WebSettings } from "../lib/web-settings";
import { webFileSystem } from "../lib/web-file-system";

export interface WebEditorProps {
  readonly document: DocumentState;
  readonly settings: WebSettings;
  readonly activeFilePath?: string | null;
  readonly resolveImageSrc?: (source: string) => string;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function WebEditor({
  document,
  settings,
  activeFilePath,
  resolveImageSrc,
  onRendererPortsChange,
}: WebEditorProps) {
  // 注入官方 MDX 组件（支持 Callout 等）
  const mdxComponents = useMemo(() => createBuiltInMdxRegistry(officialMdxPlugins), []);
  // 注入 Markdown 语法扩展插件（如高亮、:::info 容器指令、LaTeX 数学公式与 Mermaid 图表）
  const plugins = useMemo(() => {
    const all = [highlightPlugin, containerDirectivePlugin, mathPlugin, mermaidPlugin];
    if (!settings.plugins?.enabled) return all;
    return all.filter((p) => settings.plugins.enabled[p.id] ?? true);
  }, [settings.plugins]);

  const handleResolveImageSrc = useCallback(
    (source: string) => {
      if (resolveImageSrc) {
        return resolveImageSrc(source);
      }
      return webFileSystem.resolveImageSrc(source, activeFilePath);
    },
    [resolveImageSrc, activeFilePath],
  );

  return (
    <div className="relative flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]">
      <CodeMirrorEditor
        document={document}
        plugins={plugins}
        mdxMode={true}
        mdxComponents={mdxComponents}
        fontSize={settings.fontSize}
        codeBlockLineNumbers={true}
        resolveImageSrc={handleResolveImageSrc}
        onRendererPortsChange={onRendererPortsChange}
        openLinkTarget={(url) => {
          // Web 端外链一律以新标签页安全打开
          window.open(url, "_blank", "noopener,noreferrer");
        }}
      />
    </div>
  );
}
