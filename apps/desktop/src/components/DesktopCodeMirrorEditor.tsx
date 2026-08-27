import { useEffect, useRef, useState } from "react";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "@md-editor/editor-ui";
import { requestAiContinuation, getAiCompletionReadiness } from "@md-editor/ai";
import { runtime } from "../app/runtime/editor-runtime";
import { useAppSettings } from "../app/settings-context";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { inspectLinkedFileTarget, openExternalTarget } from "../desktop/link-service";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";
import {
  resolveCodeFontStack,
  resolveProseFontStack,
  type AppSettings,
} from "../app/settings/app-settings";

export interface DesktopCodeMirrorEditorProps {
  readonly hidden?: boolean;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
  readonly showToast: (message: string | null) => void;
}

export function DesktopCodeMirrorEditor({
  hidden = false,
  onRendererPortsChange,
  showToast,
}: DesktopCodeMirrorEditorProps) {
  const { settings } = useAppSettings();
  const { openDocumentFromTree } = useDesktopEditorActions();
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);

  const handlePortsChange = (newPorts: CodeMirrorEditorPorts | null) => {
    setPorts(newPorts);
    onRendererPortsChange?.(newPorts);
  };

  useAutomaticAiEditing({ ports, settings });

  // 链接打开:内部 markdown 文件在当前应用内打开,其余(资产/外部 URL)走系统打开。
  // 判定委托给 Rust 侧 inspect_linked_file(相对路径按当前文档目录解析)。
  const handleOpenLink = (url: string): void => {
    void (async () => {
      try {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
          // 显式协议(http/https/mailto 等)→ 系统浏览器/默认处理
          await openExternalTarget(url);
          return;
        }
        const documentPath = runtime.document.getSnapshot().filePath ?? "";
        const target = await inspectLinkedFileTarget(documentPath, url);
        if (target.kind === "markdown") {
          await openDocumentFromTree(target.path);
        } else {
          await openExternalTarget(target.path);
        }
      } catch {
        // 解析失败不打断编辑器(链接已过渲染层协议白名单,这里只兜底)
        showToast(`无法打开链接：${url}`);
      }
    })();
  };

  return (
    <CodeMirrorEditor
      document={runtime.document}
      className="min-h-0 flex-1"
      fontSize={settings.editor.wysiwygFontSize}
      proseFontFamily={resolveProseFontStack(settings.editor.proseFontFamily)}
      codeFontFamily={resolveCodeFontStack(settings.editor.codeFontFamily)}
      hidden={hidden}
      codeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
      resolveImageSrc={(source) =>
        resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, source)
      }
      openLinkTarget={handleOpenLink}
      onRendererPortsChange={handlePortsChange}
      onQueuedExternalEditResult={(result) => reportQueuedEditResult(result, showToast)}
      onSyncError={(error) => reportSyncError(error, showToast)}
    />
  );
}

function useAutomaticAiEditing({
  ports,
  settings,
}: {
  readonly ports: CodeMirrorEditorPorts | null;
  readonly settings: AppSettings;
}) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portsRef = useRef<CodeMirrorEditorPorts | null>(ports);
  const lastAnalyzedTextRef = useRef<string>("");
  portsRef.current = ports;

  useEffect(() => {
    if (!settings.ai.enabled || !settings.ai.features.editing) {
      return;
    }
    if (getAiCompletionReadiness(settings.ai, "editing") !== null) {
      return;
    }

    const unsubscribe = runtime.document.subscribeTransitions((event) => {
      // 换文档或重置文档时清除缓存
      if (event.transition.kind === "document-replace") {
        lastAnalyzedTextRef.current = "";
        return;
      }

      // 仅响应编辑器直接输入变更
      if (event.transition.kind !== "content" || event.transition.origin.kind !== "renderer") {
        return;
      }

      // 清除上一次未触发的定时器与未完成的请求
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      const currentPorts = portsRef.current;
      if (!currentPorts) {
        return;
      }

      // 用户停止输入后防抖 1200ms
      timerRef.current = setTimeout(async () => {
        const activePorts = portsRef.current;
        if (!activePorts) {
          return;
        }
        // 如果当前已有建议展示，暂不覆盖
        if (activePorts.getSuggestion() !== null) {
          return;
        }

        const selection = activePorts.getSelectionSnapshot();
        // 仅在光标处于单点（无手动选区）时进行背景智能诊断
        if (selection.from !== selection.to) {
          return;
        }

        const snapshot = runtime.document.getSnapshot();
        const markdown = snapshot.markdown;
        const cursorPos = selection.from;

        // 定位当前句子/行范围
        const lineStart = markdown.lastIndexOf("\n", cursorPos - 1) + 1;
        const lineEndIndex = markdown.indexOf("\n", cursorPos);
        const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
        const lineText = markdown.slice(lineStart, lineEnd).trim();

        // 忽略过短或空内容
        if (lineText.length < 4) {
          return;
        }

        // 内容指纹去重：若当前文本与最近分析成功的文本完全一致，直接跳过，避免重复调用
        if (lastAnalyzedTextRef.current === lineText) {
          return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
          const suggestion = await requestAiContinuation(
            settings.ai,
            {
              before: markdown.slice(0, lineStart),
              after: markdown.slice(lineEnd),
              selectedText: markdown.slice(lineStart, lineEnd),
              mode: snapshot.mode,
              document: {
                filePath: snapshot.filePath,
              },
            },
            {
              intent: "editing",
              signal: abortController.signal,
            },
          );

          if (abortController.signal.aborted) {
            return;
          }

          // 记录已分析内容指纹
          lastAnalyzedTextRef.current = lineText;

          if (suggestion.edit && suggestion.edit.original) {
            const rawLine = markdown.slice(lineStart, lineEnd);
            if (rawLine.includes(suggestion.edit.original)) {
              const offset = rawLine.indexOf(suggestion.edit.original);
              const editFrom = lineStart + offset;
              const editTo = editFrom + suggestion.edit.original.length;

              activePorts.showSuggestion({
                from: editFrom,
                to: editTo,
                text: suggestion.edit.replacement,
                originalText: suggestion.edit.original,
                explanation: suggestion.edit.reason,
              });
            }
          }
        } catch {
          // 后台自动检查静默忽略错误，不打扰写作
        } finally {
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
          }
        }
      }, 1200);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [settings.ai]);
}

function reportQueuedEditResult(
  result: CodeMirrorEditorExternalEditResult,
  showToast: (message: string | null) => void,
): void {
  if (result.status === "applied" || result.status === "noop") {
    return;
  }
  if (result.status === "cancelled" && result.reason === "superseded") {
    return;
  }
  showToast(`延迟编辑未能完成：${result.status}。`);
}

function reportSyncError(
  error: CodeMirrorEditorSyncError,
  showToast: (message: string | null) => void,
): void {
  const detail = error.kind === "renderer-sync" ? error.delivery.status : error.result.status;
  showToast(`编辑器同步失败：${detail}。请重新打开当前文档。`);
}
