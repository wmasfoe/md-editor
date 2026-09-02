import { useEffect, useRef, useState } from "react";
import {
  CodeMirrorEditor,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "@md-editor/editor-ui";
import { requestAiContinuation, documentContextManager } from "@md-editor/ai";
import { desktopLocalAiInvokeImpl } from "../app/ai/local-ai-model";
import { runtime } from "../app/runtime/editor-runtime";
import { useAppSettings } from "../app/settings-context";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { inspectLinkedFileTarget, openExternalTarget } from "../desktop/link-service";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";
import { bindDropImageListener } from "../app/events/drop-image-listener";
import { bindPasteImageListener } from "../app/events/paste-image-listener";
import type { PasteImageRuntime } from "../lib/paste-image";
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
  const { openDocumentFromTree, dispatchCommand } = useDesktopEditorActions();
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);

  const handlePortsChange = (newPorts: CodeMirrorEditorPorts | null) => {
    setPorts(newPorts);
    onRendererPortsChange?.(newPorts);
  };

  useAutomaticAiEditing({ ports, settings });

  // 绑定图片粘贴与拖拽导入监听器
  useEffect(() => {
    const pasteRuntime: PasteImageRuntime = {
      ensureDocumentSaved: async () => {
        if (!runtime.document.getSnapshot().filePath) {
          await dispatchCommand("file.save");
        }
        return Boolean(runtime.document.getSnapshot().filePath);
      },
      runFileAction: async (_label, action) => {
        await action();
      },
      applyMarkdown: (nextMarkdown) => {
        const current = runtime.document.getSnapshot();
        runtime.document.replaceDocument(
          {
            markdown: nextMarkdown,
            savedMarkdown: current.savedMarkdown,
            filePath: current.filePath,
          },
          { kind: "command", commandId: "editor.pasteImage" },
        );
      },
      getCursorPosition: () => {
        return ports?.getSelectionSnapshot().head ?? null;
      },
      assetsDirectory: settings.assetsDirectory,
    };

    const cleanupDrop = bindDropImageListener(pasteRuntime);
    const cleanupPaste = bindPasteImageListener(pasteRuntime);

    return () => {
      cleanupDrop();
      cleanupPaste();
    };
  }, [settings.assetsDirectory, dispatchCommand, ports]);

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

  const isMdxDocument = runtime.document.getSnapshot().filePath?.endsWith(".mdx") ?? false;

  return (
    <CodeMirrorEditor
      document={runtime.document}
      className="min-h-0 flex-1"
      fontSize={settings.editor.wysiwygFontSize}
      proseFontFamily={resolveProseFontStack(settings.editor.proseFontFamily)}
      codeFontFamily={resolveCodeFontStack(settings.editor.codeFontFamily)}
      hidden={hidden}
      codeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
      mdxMode={isMdxDocument}
      mdxComponents={runtime.mdxComponents}
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
    // 若 AI 未启用，或未开启任何 AI 特性，则不启动后台监听
    if (
      !settings.ai.enabled ||
      (!settings.ai.features.editing && !settings.ai.features.continuation)
    ) {
      if (import.meta.env.DEV) {
        console.debug("[AI Auto] AI 功能未启用，跳过自动检测。");
      }
      return;
    }

    if (import.meta.env.DEV) {
      console.debug(
        "[AI Auto] 成功注册输入完成自动建议流水线 (优先语法润色 -> 无误触发续写, provider:",
        settings.ai.provider,
        ")",
      );
    }

    const unsubscribe = runtime.document.subscribeTransitions((event) => {
      // 换文档或重置文档时清除缓存并触发新文档的确定性大纲提取与后台提炼
      if (event.transition.kind === "document-replace") {
        lastAnalyzedTextRef.current = "";
        const snap = runtime.document.getSnapshot();
        const docKey = snap.filePath || "untitled";
        if (snap.markdown.trim()) {
          documentContextManager.getOrExtract(docKey, snap.markdown);
          if (
            settings.ai.enabled &&
            settings.ai.provider === "local" &&
            settings.ai.localModel.enabled &&
            settings.ai.localModel.status === "available"
          ) {
            documentContextManager
              .scheduleDistillation(docKey, snap.markdown, {
                settings: settings.ai,
                localInvokeImpl: desktopLocalAiInvokeImpl,
                onUpdate: (ctx) => {
                  if (import.meta.env.DEV) {
                    console.debug("[AI DocContext] 后台提炼已更新:", ctx);
                  }
                },
              })
              .catch(() => {});
          }
        }
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

      // 用户停止输入后防抖 650ms (本地) / 1000ms (云端) 触发流水线
      timerRef.current = setTimeout(
        async () => {
          const activePorts = portsRef.current;
          if (!activePorts) {
            return;
          }
          // 如果当前已有建议展示，暂不覆盖
          if (activePorts.getSuggestion() !== null) {
            if (import.meta.env.DEV) {
              console.debug("[AI Auto] 当前已有展示中的建议，跳过本次自动检测。");
            }
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

          // 获取光标前后的上下文
          const before = markdown.slice(0, cursorPos);
          const after = markdown.slice(cursorPos);

          // 定位光标所在的当前行/当前待审校句子
          const lineStart = markdown.lastIndexOf("\n", cursorPos - 1) + 1;
          const lineEndIndex = markdown.indexOf("\n", cursorPos);
          const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
          const rawLine = markdown.slice(lineStart, lineEnd);
          const currentLineText = rawLine.trim();

          // 忽略完全空白或过短前文
          if (before.trim().length < 2) {
            return;
          }

          // 去重：若当前输入位置与前文完全相同则跳过
          const cacheKey = `${cursorPos}:${before}`;
          if (lastAnalyzedTextRef.current === cacheKey) {
            return;
          }

          const docKey = snapshot.filePath || "untitled";
          const docContext = documentContextManager.getOrExtract(docKey, markdown);

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          try {
            // =========================================================
            // 阶段 1：优先触发「AI 语法与润色修复」
            // =========================================================
            let hasRenderedEditSuggestion = false;

            if (settings.ai.features.editing && currentLineText.length >= 3) {
              if (import.meta.env.DEV) {
                console.debug("[AI 流水线] ▶ 阶段 1：优先发起「AI 语法与润色修复」审校...", {
                  cursorPos,
                  currentLineText,
                });
              }

              const editResult = await requestAiContinuation(
                settings.ai,
                {
                  before,
                  after,
                  selectedText: currentLineText,
                  mode: snapshot.mode,
                  document: {
                    filePath: snapshot.filePath,
                  },
                  documentContext: docContext,
                },
                {
                  intent: "editing",
                  signal: abortController.signal,
                  localInvokeImpl: desktopLocalAiInvokeImpl,
                  documentContext: docContext,
                },
              );

              if (abortController.signal.aborted) {
                return;
              }

              if (import.meta.env.DEV) {
                console.debug("[AI 流水线] 阶段 1 审校解析结果:", editResult);
              }

              if (editResult.hasEdit && editResult.edit && editResult.edit.replacement) {
                const diffs =
                  editResult.edit.diffs && editResult.edit.diffs.length > 0
                    ? editResult.edit.diffs
                    : [
                        {
                          original: editResult.edit.original,
                          replacement: editResult.edit.replacement,
                          utf16From: editResult.edit.utf16From,
                          utf16To: editResult.edit.utf16To,
                        },
                      ];

                const items = diffs
                  .map((diff) => {
                    let itemFrom = lineStart;
                    let itemTo = lineEnd;
                    const originalText = diff.original;

                    if (typeof diff.utf16From === "number" && typeof diff.utf16To === "number") {
                      itemFrom = lineStart + diff.utf16From;
                      itemTo = lineStart + diff.utf16To;
                    } else if (diff.original && currentLineText.includes(diff.original)) {
                      const offset = currentLineText.indexOf(diff.original);
                      itemFrom = lineStart + offset;
                      itemTo = itemFrom + diff.original.length;
                    }

                    return {
                      from: itemFrom,
                      to: itemTo,
                      text: diff.replacement,
                      originalText,
                      explanation: editResult.edit?.reason,
                    };
                  })
                  .filter(
                    (item) =>
                      item.from <= item.to &&
                      item.text.length > 0 &&
                      item.originalText !== item.text,
                  );

                if (items.length > 0) {
                  if (import.meta.env.DEV) {
                    console.debug(
                      `[AI 流水线] ⏸ 阶段 1 发现 ${items.length} 处修改建议 (hasEdit: true)，渲染 Diff 队列并终止后续阶段 2 续写:`,
                      items,
                    );
                  }

                  activePorts.showSuggestion({
                    items,
                    activeIndex: 0,
                    from: items[0].from,
                    to: items[0].to,
                    text: items[0].text,
                    originalText: items[0].originalText,
                    explanation: items[0].explanation,
                  });
                  hasRenderedEditSuggestion = true;
                  lastAnalyzedTextRef.current = cacheKey;
                  return; // 存在语法/润色问题并已展示修改建议，结束流程（不触发续写）
                }
              } else if (import.meta.env.DEV) {
                console.debug(
                  "[AI 流水线] ⏩ 阶段 1 审校完成：未发现语法问题 (hasEdit: false)，准备进入阶段 2 续写...",
                );
              }
            }

            // =========================================================
            // 阶段 2：语法检查无误（或未开启语法审校），紧接着触发「AI 续写」
            // =========================================================
            if (!hasRenderedEditSuggestion && settings.ai.features.continuation) {
              // 确认光标依然没有展示中的建议
              if (activePorts.getSuggestion() !== null) {
                return;
              }

              if (import.meta.env.DEV) {
                console.debug(
                  "[AI 流水线] ▶ 阶段 2：语法无误，触发光标处「AI 行内续写 (Ghost Text)」...",
                  {
                    cursorPos,
                    beforeLength: before.length,
                  },
                );
              }

              const continuationResult = await requestAiContinuation(
                settings.ai,
                {
                  before,
                  after,
                  selectedText: "",
                  mode: snapshot.mode,
                  document: {
                    filePath: snapshot.filePath,
                  },
                  documentContext: docContext,
                },
                {
                  intent: "continuation",
                  isGhostText: true,
                  signal: abortController.signal,
                  localInvokeImpl: desktopLocalAiInvokeImpl,
                  documentContext: docContext,
                },
              );

              if (abortController.signal.aborted) {
                return;
              }

              if (import.meta.env.DEV) {
                console.debug("[AI 流水线] 阶段 2 续写解析结果:", continuationResult);
              }

              if (continuationResult.hasContinuation && continuationResult.continuation) {
                if (import.meta.env.DEV) {
                  console.debug(
                    "[AI 流水线] ✔ 阶段 2 获得续写内容，渲染 Ghost Text:",
                    continuationResult.continuation,
                  );
                }

                activePorts.showSuggestion({
                  from: cursorPos,
                  to: cursorPos,
                  text: continuationResult.continuation,
                });
              }
            }

            lastAnalyzedTextRef.current = cacheKey;
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn("[AI Auto] 自动建议流水线发生异常:", error);
            }
          } finally {
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          }
        },
        settings.ai.provider === "local" ? 650 : 1000,
      );
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
