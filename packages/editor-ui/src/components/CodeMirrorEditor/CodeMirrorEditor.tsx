import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { DocumentState } from "@md-editor/editor-core";
import { useTranslation } from "@md-editor/i18n";
import { useOptionalEditorUiActions } from "../../hooks/useEditorUi";
import {
  createCodeMirrorEditorBridge,
  type CodeMirrorEditorBridge,
  type MdxComponentsLookup,
  type CodeMirrorEditorClipboardWriter,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
  type MarkdownSyntaxPlugin,
  type AiSuggestionLabels,
} from "@md-editor/renderer-codemirror";
import "./CodeMirrorEditor.css";

export interface CodeMirrorEditorProps {
  readonly document: DocumentState;
  readonly codeBlockLineNumbers?: boolean;
  /** 是否常显加粗/斜体/删除线/行内代码的 markdown 标记源码（默认 false = 仅触及时临时显形）。 */
  readonly showInlineStyleMarkers?: boolean;
  /** 是否开启实时 Markdown 规范检查（默认 false，移动端与官网保持纯净）。 */
  readonly enableMarkdownLint?: boolean;
  readonly fontSize?: number;
  readonly proseFontFamily?: string;
  readonly codeFontFamily?: string;
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
  readonly onSyncError?: (error: CodeMirrorEditorSyncError) => void;
  readonly onQueuedExternalEditResult?: (result: CodeMirrorEditorExternalEditResult) => void;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
}

export function CodeMirrorEditor({
  document,
  codeBlockLineNumbers = false,
  showInlineStyleMarkers = false,
  enableMarkdownLint = false,
  fontSize,
  proseFontFamily,
  codeFontFamily,
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
  onSyncError,
  onQueuedExternalEditResult,
  onRendererPortsChange,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<CodeMirrorEditorBridge | null>(null);
  const uiActions = useOptionalEditorUiActions();
  const uiActionsRef = useRef(uiActions);
  uiActionsRef.current = uiActions;
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
      onCursorLineChange(line) {
        callbacksRef.current.onCursorLineChange?.(line);
        uiActionsRef.current?.updateActiveOutlineForLine(line);
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

  // ports 注册独立于 bridge 生命周期，即便外部 actions 发生引用变动也绝不销毁重建编辑器 DOM
  useLayoutEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !uiActions) {
      return;
    }
    return uiActions.registerRendererPorts(bridge.ports);
  }, [uiActions]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setCodeBlockLineNumbers(codeBlockLineNumbers);
  }, [codeBlockLineNumbers]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setInlineStyleMarkers(showInlineStyleMarkers);
  }, [showInlineStyleMarkers]);

  const { i18n } = useTranslation();
  const currentLanguage = i18n?.language;

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setMarkdownLint(enableMarkdownLint);
  }, [enableMarkdownLint]);

  useLayoutEffect(() => {
    if (enableMarkdownLint) {
      bridgeRef.current?.ports.recomputeMarkdownLint();
    }
  }, [currentLanguage, enableMarkdownLint]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLanguageChange = () => {
      if (enableMarkdownLint) {
        bridgeRef.current?.ports.recomputeMarkdownLint();
      }
    };
    window.addEventListener("md-editor:language-changed", handleLanguageChange);
    return () => {
      window.removeEventListener("md-editor:language-changed", handleLanguageChange);
    };
  }, [enableMarkdownLint]);

  useLayoutEffect(() => {
    if (aiSuggestionLabels) {
      bridgeRef.current?.ports.setAiSuggestionLabels(aiSuggestionLabels);
    }
  }, [aiSuggestionLabels]);

  useLayoutEffect(() => {
    // 字体与字号会改变行高和字符宽度，通知 CodeMirror 丢弃旧测量缓存。
    bridgeRef.current?.ports.requestMeasure();
  }, [fontSize, proseFontFamily, codeFontFamily]);

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
    proseFontFamily || codeFontFamily
      ? ({
          ...(proseFontFamily ? { "--theme-font": proseFontFamily } : {}),
          ...(codeFontFamily ? { "--theme-mono-font": codeFontFamily } : {}),
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
