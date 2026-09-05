import React, { useMemo } from "react";
import { CodeMirrorEditor, type CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import type { DocumentState } from "@md-editor/editor-core";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-component-registry";
import { officialMdxPlugins } from "@md-editor/mdx-plugins/metadata";
import type { WebSettings } from "../lib/web-settings";

export interface WebEditorProps {
  readonly document: DocumentState;
  readonly settings: WebSettings;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function WebEditor({ document, settings, onRendererPortsChange }: WebEditorProps) {
  // 注入官方 MDX 组件（支持 :::tip, :::warning, Callout 等）
  const mdxComponents = useMemo(() => createBuiltInMdxRegistry(officialMdxPlugins), []);

  return (
    <div className="relative flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]">
      <CodeMirrorEditor
        document={document}
        mdxMode={true}
        mdxComponents={mdxComponents}
        fontSize={settings.fontSize}
        codeBlockLineNumbers={true}
        onRendererPortsChange={onRendererPortsChange}
        openLinkTarget={(url) => {
          // Web 端外链一律以新标签页安全打开
          window.open(url, "_blank", "noopener,noreferrer");
        }}
      />
    </div>
  );
}
