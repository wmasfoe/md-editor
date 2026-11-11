import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { DocumentState } from "@md-editor/core";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import {
  createCodeMirrorEditorBridge,
  type CodeMirrorEditorBridge,
  type MdxComponentsLookup,
  type CodeMirrorEditorClipboardWriter,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "../bridge.ts";
import type {
  AiSuggestionAcceptedEvent,
  AiSuggestionLabels,
} from "../wysiwyg/view/suggestion-model.ts";
import "./CodeMirrorEditor.css";

export interface CodeMirrorEditorProps {
  readonly document: DocumentState;
  /** Host language revision; changing it refreshes localized lint diagnostics. */
  readonly language?: string;
  readonly codeBlockLineNumbers?: boolean;
  /** 是否常显加粗/斜体/删除线/行内代码的 markdown 标记源码（默认 false = 仅触及时临时显形）。 */
  readonly showInlineStyleMarkers?: boolean;
  /** 是否开启实时 Markdown 规范检查（默认 false，移动端与官网保持纯净）。 */
  readonly enableMarkdownLint?: boolean;
  readonly fontSize?: number;
  readonly proseFontFamily?: string;
  readonly codeFontFamily?: string;
  readonly headingFontFamily?: string;
  readonly lineHeight?: number;
  readonly letterSpacing?: string;
  readonly contentMaxWidth?: number | string;
  readonly boldFontWeight?: number;
  readonly headingFontWeight?: number;
  readonly hidden?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ariaLabel?: string;
  readonly resolveImageSrc?: (source: string) => string;
  readonly writeClipboardText?: CodeMirrorEditorClipboardWriter;
  /** MDX 文件模式:大写标签按组件解析(默认 false = 纯 Markdown) */
  readonly mdxMode?: boolean;
  /** MDX 组件白名单(最小查找接口,纯 metadata);缺省 = 一律占位 */
  readonly mdxComponents?: MdxComponentsLookup;
  /** 链接打开回调(宿主决策:文档内锚点跳转、内部 markdown 文件、资产与外部链接) */
  readonly openLinkTarget?: (url: string) => void;
  readonly onCursorLineChange?: (line: number) => void;
  /** 可选语法扩展插件列表（纯增量加载） */
  readonly plugins?: readonly MarkdownSyntaxPlugin[];
  /** 兼容别名：同 plugins */
  readonly syntaxPlugins?: readonly MarkdownSyntaxPlugin[];
  /** AI 建议徽标国际化标签配置 */
  readonly aiSuggestionLabels?: AiSuggestionLabels;
  /** 用户采纳一项 AI 建议后回调 */
  readonly onAiSuggestionAccepted?: (event: AiSuggestionAcceptedEvent) => void;
  readonly onSyncError?: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult?: (result: CodeMirrorEditorExternalEditResult) => void;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function CodeMirrorEditor({
  document,
  language,
  codeBlockLineNumbers = false,
  showInlineStyleMarkers = false,
  enableMarkdownLint = false,
  fontSize,
  proseFontFamily,
  codeFontFamily,
  headingFontFamily,
  lineHeight,
  letterSpacing,
  contentMaxWidth,
  boldFontWeight,
  headingFontWeight,
  hidden = false,
  className,
  style,
  ariaLabel = "Markdown 编辑器",
  resolveImageSrc,
  writeClipboardText,
  mdxMode = false,
  mdxComponents,
  openLinkTarget,
  onCursorLineChange,
  plugins,
  syntaxPlugins,
  aiSuggestionLabels,
  onAiSuggestionAccepted,
  onSyncError,
  onQueuedExternalEditResult,
  onRendererPortsChange,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<CodeMirrorEditorBridge | null>(null);
  const callbacksRef = useRef({
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    writeClipboardText,
    mdxMode,
    mdxComponents,
    openLinkTarget,
    onCursorLineChange,
    plugins,
    syntaxPlugins,
    aiSuggestionLabels,
    onAiSuggestionAccepted,
    enableMarkdownLint,
    onSyncError,
  });
  callbacksRef.current = {
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    writeClipboardText,
    mdxMode,
    mdxComponents,
    openLinkTarget,
    onCursorLineChange,
    plugins,
    syntaxPlugins,
    aiSuggestionLabels,
    onAiSuggestionAccepted,
    enableMarkdownLint,
    onSyncError,
  };
  const hasClipboardWriter = writeClipboardText !== undefined;
  const [syncStatus, setSyncStatus] = useState<"synchronized" | "sync-error">("synchronized");
  const subscribeSnapshot = useCallback(
    (onStoreChange: () => void) => document.subscribeSnapshot(onStoreChange),
    [document],
  );
  const getSnapshot = useCallback(() => document.getSnapshot(), [document]);
  const snapshot = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  useLayoutEffect(() => {
    const parent = hostRef.current;
    if (!parent) {
      throw new Error("CodeMirrorEditor requires a mounted host element.");
    }

    const bridge = createCodeMirrorEditorBridge({
      parent,
      document,
      resolveImageSrc(source) {
        return callbacksRef.current.resolveImageSrc?.(source) ?? source;
      },
      writeClipboardText: hasClipboardWriter
        ? (text) => {
            const writer = callbacksRef.current.writeClipboardText;
            if (!writer) {
              throw new Error("CodeMirrorEditor clipboard writer was not initialized.");
            }
            return writer(text);
          }
        : undefined,
      onAiSuggestionAccepted(event) {
        callbacksRef.current.onAiSuggestionAccepted?.(event);
      },
      onCursorLineChange(line) {
        callbacksRef.current.onCursorLineChange?.(line);
      },
      onSyncError(error) {
        setSyncStatus("sync-error");
        callbacksRef.current.onSyncError?.(error);
      },
      onQueuedExternalEditResult(result) {
        callbacksRef.current.onQueuedExternalEditResult?.(result);
      },
      mdxMode: callbacksRef.current.mdxMode,
      mdxComponents: callbacksRef.current.mdxComponents,
      openLinkTarget: callbacksRef.current.openLinkTarget,
      plugins: callbacksRef.current.plugins ?? callbacksRef.current.syntaxPlugins,
      aiSuggestionLabels: callbacksRef.current.aiSuggestionLabels,
      enableMarkdownLint: callbacksRef.current.enableMarkdownLint,
    });
    bridgeRef.current = bridge;
    callbacksRef.current.onRendererPortsChange?.(bridge.ports);

    return () => {
      bridgeRef.current = null;
      bridge.destroy();
      callbacksRef.current.onRendererPortsChange?.(null);
    };
  }, [document, hasClipboardWriter]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setCodeBlockLineNumbers(codeBlockLineNumbers);
  }, [codeBlockLineNumbers]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setInlineStyleMarkers(showInlineStyleMarkers);
  }, [showInlineStyleMarkers]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setMarkdownLint(enableMarkdownLint);
  }, [enableMarkdownLint]);

  useLayoutEffect(() => {
    if (enableMarkdownLint) {
      bridgeRef.current?.ports.recomputeMarkdownLint();
    }
  }, [language, enableMarkdownLint]);

  useLayoutEffect(() => {
    if (aiSuggestionLabels) {
      bridgeRef.current?.ports.setAiSuggestionLabels(aiSuggestionLabels);
    }
  }, [aiSuggestionLabels]);

  useLayoutEffect(() => {
    // 字体、字号、字重、字距、行高或版心变动会改变文本测量和坐标，通知 CodeMirror 丢弃旧测量缓存。
    bridgeRef.current?.ports.requestMeasure();
  }, [
    fontSize,
    proseFontFamily,
    codeFontFamily,
    headingFontFamily,
    lineHeight,
    letterSpacing,
    contentMaxWidth,
    boldFontWeight,
    headingFontWeight,
  ]);

  useLayoutEffect(() => {
    const activePlugins = plugins ?? syntaxPlugins;
    if (activePlugins !== undefined) {
      bridgeRef.current?.ports.setPlugins(activePlugins);
    }
  }, [plugins, syntaxPlugins]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const bridge = bridgeRef.current;
    if (!host || !bridge) {
      return;
    }

    if (hidden) {
      bridge.ports.setHostVisibility(true);
      host.inert = true;
    } else {
      host.inert = false;
      bridge.ports.setHostVisibility(false);
    }
  }, [hidden]);

  const hiddenStyle: CSSProperties | undefined = hidden
    ? { visibility: "hidden", pointerEvents: "none" }
    : undefined;
  const fontSizeStyle: CSSProperties | undefined =
    fontSize !== undefined && Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : undefined;
  const fontStyles: CSSProperties | undefined =
    proseFontFamily ||
    codeFontFamily ||
    headingFontFamily ||
    lineHeight ||
    letterSpacing ||
    contentMaxWidth ||
    boldFontWeight ||
    headingFontWeight
      ? ({
          ...(proseFontFamily ? { "--theme-font": proseFontFamily } : {}),
          ...(codeFontFamily ? { "--theme-mono-font": codeFontFamily } : {}),
          ...(headingFontFamily ? { "--theme-heading-font": headingFontFamily } : {}),
          ...(lineHeight ? { "--theme-editor-line-height": lineHeight } : {}),
          ...(letterSpacing ? { "--theme-letter-spacing": letterSpacing } : {}),
          ...(contentMaxWidth
            ? {
                "--theme-content-width":
                  typeof contentMaxWidth === "number" ? `${contentMaxWidth}px` : contentMaxWidth,
              }
            : {}),
          ...(boldFontWeight ? { "--theme-bold-font-weight": boldFontWeight } : {}),
          ...(headingFontWeight ? { "--theme-heading-font-weight": headingFontWeight } : {}),
        } as CSSProperties)
      : undefined;

  return (
    <div
      ref={hostRef}
      className={["code-mirror-editor-host", className].filter(Boolean).join(" ")}
      style={{ ...style, ...fontSizeStyle, ...fontStyles, ...hiddenStyle }}
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
      data-document-generation={snapshot.documentGeneration}
      data-state-revision={snapshot.stateRevision}
      data-sync-status={syncStatus}
    />
  );
}
