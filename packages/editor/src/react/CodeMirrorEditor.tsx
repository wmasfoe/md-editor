import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { DocumentState } from "@md-editor/core";
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
import { compileEditorTheme } from "../theme/compile.ts";
import type { EditorTheme } from "../theme/types.ts";
import type {
  EditorMessageTranslator,
  MarkdownSyntaxPlugin,
  SyntaxPluginHostPorts,
} from "@md-editor/plugin-sdk/syntax";
import type { MarkdownLintEngine } from "../lint/engine.ts";
import "./CodeMirrorEditor.css";

export interface CodeMirrorEditorProps {
  readonly document: DocumentState;
  /**
   * 官方主题通道：编译为 `--theme-*` 变量注入宿主元素。
   *
   * 与 `--theme-*` 直接写在 CSS 里的关系：`theme` 写在宿主元素上（element-level），
   * 因此优先级高于祖先 `:root` 的变量；缺省由 CSS 的 `var(--x, fallback)` 兜底。
   */
  readonly theme?: EditorTheme;
  /** 是否自动注入编辑器样式（默认 true）。仅创建时生效。 */
  readonly injectStyles?: boolean;
  /** CSP nonce，透传给自动注入的 `<style nonce>`。仅创建时生效。 */
  readonly styleNonce?: string;
  /** 语法插件宿主端口（媒体查看器 / callout widget）。缺省用渲染器自带实现。 */
  readonly syntaxPluginHostPorts?: SyntaxPluginHostPorts;
  /** 专注模式遮罩强度（0.30–0.50，越界夹紧）。 */
  readonly focusDimOpacity?: number;
  /** Per-editor language for lint diagnostics. */
  readonly language?: string;
  readonly translateEditorMessage?: EditorMessageTranslator | undefined;
  readonly codeBlockLineNumbers?: boolean;
  /** 是否常显加粗/斜体/删除线/行内代码的 markdown 标记源码（默认 false = 仅触及时临时显形）。 */
  readonly showInlineStyleMarkers?: boolean;
  /** 是否开启实时 Markdown 规范检查（默认 false，移动端与官网保持纯净）。 */
  readonly enableMarkdownLint?: boolean;
  /**
   * 宿主注入的 lint 引擎；编辑器不再静态依赖 `markdownlint`。
   *
   * ```tsx
   * import { lint } from "markdownlint/sync";
   * <CodeMirrorEditor markdownlint={{ lint }} enableMarkdownLint />
   * ```
   * 可在运行中更换：引擎变化会就地补注（`ports.setMarkdownLintEngine`），**不会**重建编辑器。
   * 比较依据是引擎上各函数的身份（`lint` / `readConfig` / `applyFixes`），因此内联字面量
   * `markdownlint={{ lint }}` 不会在每次宿主渲染时重复重配 —— 前提是这些函数本身引用稳定
   * （应用侧用 `useMarkdownLintEngine` 或 `useMemo` 即可）。
   */
  readonly markdownlint?: MarkdownLintEngine;
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
  /** 声明式语法扩展插件列表（纯增量加载）。 */
  readonly plugins?: readonly MarkdownSyntaxPlugin[];
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
  theme,
  injectStyles,
  styleNonce,
  syntaxPluginHostPorts,
  focusDimOpacity,
  language,
  translateEditorMessage,
  codeBlockLineNumbers = false,
  showInlineStyleMarkers = false,
  enableMarkdownLint = false,
  markdownlint,
  hidden = false,
  className,
  style,
  ariaLabel = "Markdown editor",
  resolveImageSrc,
  writeClipboardText,
  mdxMode = false,
  mdxComponents,
  openLinkTarget,
  onCursorLineChange,
  plugins,
  aiSuggestionLabels,
  onAiSuggestionAccepted,
  onSyncError,
  onQueuedExternalEditResult,
  onRendererPortsChange,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<CodeMirrorEditorBridge | null>(null);
  const callbacksRef = useRef({
    markdownlint,
    focusDimOpacity,
    syntaxPluginHostPorts,
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    writeClipboardText,
    mdxMode,
    mdxComponents,
    openLinkTarget,
    onCursorLineChange,
    plugins,
    aiSuggestionLabels,
    onAiSuggestionAccepted,
    enableMarkdownLint,
    language,
    translateEditorMessage,
    onSyncError,
  });
  callbacksRef.current = {
    markdownlint,
    focusDimOpacity,
    syntaxPluginHostPorts,
    onQueuedExternalEditResult,
    onRendererPortsChange,
    resolveImageSrc,
    writeClipboardText,
    mdxMode,
    mdxComponents,
    openLinkTarget,
    onCursorLineChange,
    plugins,
    aiSuggestionLabels,
    onAiSuggestionAccepted,
    enableMarkdownLint,
    language,
    translateEditorMessage,
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
      injectStyles,
      styleNonce,
      syntaxPluginHostPorts: callbacksRef.current.syntaxPluginHostPorts,
      focusDimOpacity: callbacksRef.current.focusDimOpacity,
      markdownlint: callbacksRef.current.markdownlint,
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
      plugins: callbacksRef.current.plugins,
      aiSuggestionLabels: callbacksRef.current.aiSuggestionLabels,
      enableMarkdownLint: callbacksRef.current.enableMarkdownLint,
      language: callbacksRef.current.language,
      translateEditorMessage: (key, fallback) =>
        callbacksRef.current.translateEditorMessage?.(key, fallback) ?? fallback,
    });
    bridgeRef.current = bridge;
    callbacksRef.current.onRendererPortsChange?.(bridge.ports);

    return () => {
      bridgeRef.current = null;
      bridge.destroy();
      callbacksRef.current.onRendererPortsChange?.(null);
    };
    // 创建只依赖这些稳定输入。lint 引擎刻意不在其中：它走下面的补注 effect，
    // 更换引擎不需要（也不应该）重建编辑器。
  }, [document, hasClipboardWriter, injectStyles, styleNonce]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setCodeBlockLineNumbers(codeBlockLineNumbers);
  }, [codeBlockLineNumbers]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setInlineStyleMarkers(showInlineStyleMarkers);
  }, [showInlineStyleMarkers]);

  // 引擎与开关**一次提交**：分成两个 effect 时，从「有引擎 + 已开启」切到
  // 「无引擎 + 已关闭」会出现「开关 true + 无引擎」的中间态（引擎先撤、开关后关），
  // 校验随即抛错。调换顺序只是把问题挪到开启路径。
  //
  // 依赖刻意取引擎上各**函数**的身份，而不是引擎对象身份：README 推荐的
  // `markdownlint={{ lint }}` 每次宿主渲染都会产生新对象，用对象身份会每次都
  // reconfigure 一次 compartment（开关开着时还会重跑整份 lint）。
  useLayoutEffect(() => {
    bridgeRef.current?.ports.configureMarkdownLint({
      engine: markdownlint,
      enabled: enableMarkdownLint,
    });
    // 故意只依赖三个函数身份：`markdownlint` 对象本身每次渲染都可能变（内联字面量），
    // 用对象身份会退化成"每次渲染都重配一次"。三个函数已完整覆盖引擎的可观察行为。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownlint?.lint, markdownlint?.readConfig, markdownlint?.applyFixes, enableMarkdownLint]);

  useLayoutEffect(() => {
    bridgeRef.current?.ports.setLanguage(language);
  }, [language, document, hasClipboardWriter]);

  // 主题变化会改变文本测量与坐标；用编译后变量的签名做依赖，避免同值对象抖动。
  const themeSignature = JSON.stringify(compileEditorTheme(theme));
  useLayoutEffect(() => {
    bridgeRef.current?.ports.requestMeasure();
  }, [themeSignature]);

  useLayoutEffect(() => {
    if (aiSuggestionLabels) {
      bridgeRef.current?.ports.setAiSuggestionLabels(aiSuggestionLabels);
    }
  }, [aiSuggestionLabels]);

  useLayoutEffect(() => {
    // 字体、字号、字重、字距、行高或版心变动会改变文本测量和坐标，通知 CodeMirror 丢弃旧测量缓存。
    bridgeRef.current?.ports.requestMeasure();
  }, []);

  useLayoutEffect(() => {
    if (plugins !== undefined) {
      bridgeRef.current?.ports.setSyntaxPlugins(plugins);
    }
  }, [plugins]);

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
  const themeStyle: CSSProperties | undefined =
    theme === undefined
      ? undefined
      : ({
          ...compileEditorTheme(theme),
          ...(theme.base ? { colorScheme: theme.base } : {}),
        } as CSSProperties);

  return (
    <div
      ref={hostRef}
      className={["code-mirror-editor-host", className].filter(Boolean).join(" ")}
      style={{ ...style, ...themeStyle, ...hiddenStyle }}
      aria-label={ariaLabel}
      aria-hidden={hidden || undefined}
      data-document-generation={snapshot.documentGeneration}
      data-state-revision={snapshot.stateRevision}
      data-sync-status={syncStatus}
    />
  );
}
