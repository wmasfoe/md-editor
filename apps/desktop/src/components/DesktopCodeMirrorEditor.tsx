import { useEffect, useMemo, useRef, useState } from "react";
import {
  CodeMirrorEditor,
  type AiSuggestionItem,
  type CodeMirrorEditorPorts,
  resolveCodeFontStack,
  resolveProseFontStack,
} from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import { shouldSkipAutoGec } from "@md-editor/ai";
import { desktopAiService } from "../app/ai/desktop-ai-service";
import { useAcceptedAiTextRecorder } from "../app/ai/style-learning/use-accepted-ai-text";
import { runtime } from "../app/runtime/editor-runtime";
import { useAppSettings } from "../app/settings-context";
import { useDocumentSnapshot } from "../app/document-store";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";
import { bindDropImageListener } from "../app/events/drop-image-listener";
import { bindPasteImageListener } from "../app/events/paste-image-listener";
import type { PasteImageRuntime } from "../lib/paste-image";
import { useConfirmationStore } from "../app/stores/confirmation-store";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import type { AppSettings } from "../app/settings/app-settings";

export interface DesktopCodeMirrorEditorProps {
  readonly hidden?: boolean;
  readonly externalPlugins?: readonly MarkdownSyntaxPlugin[];
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
  readonly showToast: (message: string | null) => void;
}

const DESKTOP_SYNTAX_PLUGINS = [
  highlightPlugin,
  containerDirectivePlugin,
  mathPlugin,
  mermaidPlugin,
];

export function DesktopCodeMirrorEditor({
  hidden = false,
  externalPlugins = [],
  onRendererPortsChange,
  showToast,
}: DesktopCodeMirrorEditorProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const { openWysiwygLink, dispatchCommand, refreshFolderForDocumentPath } =
    useDesktopEditorActions();
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);

  const aiSuggestionLabels = useMemo(
    () => ({
      accept: t("editor.suggestion.accept"),
      dismiss: t("editor.suggestion.dismiss"),
      kindFix: t("editor.suggestion.kindFix"),
      kindStyle: t("editor.suggestion.kindStyle"),
    }),
    [t],
  );
  const recordAcceptedAiText = useAcceptedAiTextRecorder();

  const handlePortsChange = (newPorts: CodeMirrorEditorPorts | null) => {
    setPorts(newPorts);
    onRendererPortsChange?.(newPorts);
  };

  // 同步用户在设置中自定义的快捷键至 CodeMirror 格式化按键扩展
  useEffect(() => {
    if (!ports) {
      return;
    }
    const customKeymaps = new Map(settings.shortcuts.map((s) => [s.id, s.key]));
    ports.setFormattingKeymaps(customKeymaps);
  }, [ports, settings.shortcuts]);

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
        if (ports) {
          const res = ports.applyExternalEdit({
            operationId: `desktop:paste-image:${Date.now()}`,
            markdown: nextMarkdown,
            expectedGeneration: current.documentGeneration,
            expectedContentRevision: current.contentRevision,
            selection: "preserve-offset-clamped",
          });
          if (
            res.status === "applied" ||
            res.status === "noop" ||
            res.status === "queued-composition"
          ) {
            return;
          }
        }
        runtime.document.replaceDocument(
          {
            markdown: nextMarkdown,
            savedMarkdown: current.savedMarkdown,
            filePath: current.filePath,
            // 粘贴图片 = **同一篇文档内**的内容变更（走整篇替换管道）⇒ 显式声明 same，
            // 否则渲染层会把这次替换当成换文档而把正在阅读的用户弹回顶部（S7）。
            replaceIntent: "same",
          },
          { kind: "command", commandId: "editor.pasteImage" },
        );
      },
      getCursorPosition: () => {
        return ports?.getSelectionSnapshot().head ?? null;
      },
      assetsDirectory: settings.assetsDirectory,
      requestConfirmation: (state) => useConfirmationStore.getState().requestConfirmation(state),
      afterSaveImage: async (documentPath) => {
        if (documentPath) {
          await refreshFolderForDocumentPath(documentPath);
        }
      },
    };

    const cleanupDrop = bindDropImageListener(pasteRuntime);
    const cleanupPaste = bindPasteImageListener(pasteRuntime);

    return () => {
      cleanupDrop();
      cleanupPaste();
    };
  }, [settings.assetsDirectory, dispatchCommand, ports, refreshFolderForDocumentPath]);

  // 链接打开:内部文档 / 锚点 / 资产 / 外部 URL 的判定全部收敛在 controller
  // (`openWysiwygLink`)，渲染层只把通过协议白名单的 URL 交回宿主。
  // 锚点链接(`#fragment`)由 controller 交给 editor-ui 解析并滚动定位。
  const handleOpenLink = (url: string): void => {
    void openWysiwygLink(url);
  };

  const isMdxDocument =
    snapshot.filePath?.endsWith(".mdx") ||
    !snapshot.filePath ||
    /<\/?[A-Z]/.test(snapshot.markdown);

  const activePlugins = useMemo(() => {
    return [
      ...DESKTOP_SYNTAX_PLUGINS.filter((plugin) => settings.plugins.enabled[plugin.id] ?? true),
      ...externalPlugins,
    ];
  }, [settings.plugins, externalPlugins]);

  return (
    <CodeMirrorEditor
      document={runtime.document}
      plugins={activePlugins}
      className="min-h-0 flex-1"
      fontSize={settings.editor.wysiwygFontSize}
      proseFontFamily={resolveProseFontStack(settings.editor.proseFontFamily)}
      codeFontFamily={resolveCodeFontStack(settings.editor.codeFontFamily)}
      hidden={hidden}
      codeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
      showInlineStyleMarkers={settings.editor.showInlineStyleMarkers}
      enableMarkdownLint={settings.editor.enableMarkdownLint}
      ariaLabel={t("sidebar.editorAria")}
      aiSuggestionLabels={aiSuggestionLabels}
      onAiSuggestionAccepted={recordAcceptedAiText}
      mdxMode={isMdxDocument}
      mdxComponents={runtime.mdxComponents}
      resolveImageSrc={(source) =>
        resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, source)
      }
      openLinkTarget={handleOpenLink}
      onRendererPortsChange={handlePortsChange}
      onQueuedExternalEditResult={(result) => {
        if (result.status === "applied" || result.status === "noop") return;
        if (result.status === "cancelled" && result.reason === "superseded") return;
        showToast(t("toasts.delayedEditFailed", { status: result.status }));
      }}
      onSyncError={(error) => {
        const detail = error.kind === "renderer-sync" ? error.delivery.status : error.result.status;
        showToast(t("toasts.editorSyncFailed", { detail }));
      }}
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
  const distillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portsRef = useRef<CodeMirrorEditorPorts | null>(ports);
  const lastAnalyzedTextRef = useRef<string>("");
  const recentlyAcceptedRef = useRef<Map<string, number>>(new Map());
  portsRef.current = ports;

  useEffect(() => {
    // 当在设置中关闭 AI 或关闭续写时，立刻撤销当前可能残留的续写建议
    if (!settings.ai.enabled || !settings.ai.features.continuation) {
      portsRef.current?.dismissSuggestion();
    }
  }, [settings.ai.enabled, settings.ai.features.continuation]);

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

    const triggerDistillationIfEligible = (markdown: string, filePath?: string | null) => {
      if (
        markdown.trim().length >= 50 &&
        settings.ai.enabled &&
        (settings.ai.provider === "local"
          ? settings.ai.localModel.enabled && settings.ai.localModel.status === "available"
          : Boolean(settings.ai.endpoints[settings.ai.provider]?.apiKey))
      ) {
        const docKey = filePath || "untitled";
        desktopAiService
          .scheduleDistillation(docKey, markdown, {
            settings: settings.ai,
            onUpdate: (ctx) => {
              if (import.meta.env.DEV) {
                console.debug("[AI DocContext] 后台大模型文档提炼已完成:", ctx);
              }
            },
          })
          .catch(() => {});
      }
    };

    // 组件挂载时先预热基础大纲，若文档达到长度，延迟 3 秒后在后台低优先级调度大模型宏观提炼
    const initialSnap = runtime.document.getSnapshot();
    if (initialSnap.markdown.trim()) {
      desktopAiService.documentContext.getOrExtract(
        initialSnap.filePath || "untitled",
        initialSnap.markdown,
      );
      if (initialSnap.markdown.trim().length >= 50) {
        distillTimerRef.current = setTimeout(() => {
          const snap = runtime.document.getSnapshot();
          triggerDistillationIfEligible(snap.markdown, snap.filePath);
        }, 3000);
      }
    }

    const unsubscribe = runtime.document.subscribeTransitions((event) => {
      // 换文档或重置文档时清除缓存、中断正在进行的推理，并在空闲后调度大模型提炼
      if (event.transition.kind === "document-replace") {
        lastAnalyzedTextRef.current = "";
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (distillTimerRef.current) {
          clearTimeout(distillTimerRef.current);
          distillTimerRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        desktopAiService.abort(undefined);
        const snap = runtime.document.getSnapshot();
        const docKey = snap.filePath || "untitled";
        if (snap.markdown.trim()) {
          desktopAiService.documentContext.getOrExtract(docKey, snap.markdown);
          if (snap.markdown.trim().length >= 50) {
            distillTimerRef.current = setTimeout(() => {
              const currentSnap = runtime.document.getSnapshot();
              triggerDistillationIfEligible(currentSnap.markdown, currentSnap.filePath);
            }, 3000);
          }
        }
        return;
      }

      // 模式切换时：立即取消未触发的自动续写定时器并中断在途的网络/本地模型推理请求
      if (event.transition.kind === "mode") {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        desktopAiService.abort(undefined);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (distillTimerRef.current) {
          clearTimeout(distillTimerRef.current);
          distillTimerRef.current = null;
        }
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
      const snap = runtime.document.getSnapshot();
      desktopAiService.abort(snap.filePath || "untitled", "completion");
      desktopAiService.abort(snap.filePath || "untitled", "gec");

      // 用户打字时，清除旧提炼定时器；当用户完全停止打字 8 秒后（处于思考停顿状态），低优先级在后台触发大模型提炼
      if (distillTimerRef.current) {
        clearTimeout(distillTimerRef.current);
      }
      distillTimerRef.current = setTimeout(() => {
        const latestDocSnap = runtime.document.getSnapshot();
        triggerDistillationIfEligible(latestDocSnap.markdown, latestDocSnap.filePath);
      }, 8000);

      const currentPorts = portsRef.current;
      if (!currentPorts) {
        return;
      }

      // 若当前已有建议展示（如连续按 Tab 正在消费本地多段建议队列），绝不发起新网络请求打断队列
      if (currentPorts.getSuggestion() !== null) {
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

          // 忽略完全空白、过短前文，或处于代码块/公式块内部
          if (before.trim().length < 2 || shouldSkipAutoGec(currentLineText, before)) {
            return;
          }

          // 去重：若当前输入位置与前文完全相同则跳过
          const cacheKey = `${cursorPos}:${before}`;
          if (lastAnalyzedTextRef.current === cacheKey) {
            return;
          }

          const docKey = snapshot.filePath || "untitled";
          const docContext = desktopAiService.documentContext.getOrExtract(docKey, markdown);

          const abortController = new AbortController();
          abortControllerRef.current = abortController;

          // CAS 护栏：锁定发起推理时的文档版本快照
          const initialMarkdown = markdown;

          try {
            if (import.meta.env.DEV) {
              console.debug(
                `[AI Cursor Tab] ▶ 统一单次前向推理 (Single-Pass)... (provider: ${settings.ai.provider})`,
                { cursorPos, markdownLength: markdown.length },
              );
            }

            // 单次前向推理：模型直接决断是进行 Diff 错词修复还是 Ghost Text 行内续写
            const decision = await desktopAiService.predictUnifiedEdit(
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
                isGhostText: true,
                signal: abortController.signal,
              },
            );

            if (abortController.signal.aborted) {
              return;
            }

            // CAS 护栏校验：若文档在异步推理期间被用户打字更改，丢弃旧预测防止坐标漂移
            const latestSnap = runtime.document.getSnapshot();
            if (latestSnap.markdown !== initialMarkdown) {
              if (import.meta.env.DEV) {
                console.debug(
                  "[AI Cursor Tab] ⚠️ 文档在推理期间已被用户编辑修改 (CAS mismatch)，丢弃过时建议。",
                );
              }
              return;
            }

            // 确认光标依然没有展示中的建议
            if (activePorts.getSuggestion() !== null) {
              return;
            }

            if (decision.action === "none" || decision.items.length === 0) {
              if (import.meta.env.DEV) {
                console.debug("[AI Cursor Tab] ⏩ 推理决策为无需修改/续写 (action: none)。");
              }
              lastAnalyzedTextRef.current = cacheKey;
              return;
            }

            // 计算微观切片在全篇文档中的绝对起始偏移量
            const microPrefixLength = decision.slicePrefixLength ?? Math.min(before.length, 1500);
            const sliceStartInDoc = before.length - microPrefixLength;

            const now = Date.now();
            for (const [key, ts] of recentlyAcceptedRef.current) {
              if (now - ts > 8_000) {
                recentlyAcceptedRef.current.delete(key);
              }
            }

            const items: AiSuggestionItem[] = [];

            for (const item of decision.items) {
              if (item.action === "continuation") {
                if (!settings.ai.features.continuation) {
                  continue;
                }
                // Continuation: 幽灵续写锚定在当前光标处
                items.push({
                  from: cursorPos,
                  to: cursorPos,
                  text: item.text,
                });
              } else if (item.action === "edit") {
                if (!settings.ai.features.editing) {
                  continue;
                }
                // Edit: 将相对切片坐标转为全篇绝对坐标
                const absFrom = sliceStartInDoc + item.fromOffset;
                const absTo = sliceStartInDoc + item.toOffset;

                // 循环防护：避免模型反复针对相同区间产生往复 ping-pong 建议
                const fingerprint = `${absFrom}:${absTo}:${item.text}`;
                if (recentlyAcceptedRef.current.has(fingerprint)) {
                  if (import.meta.env.DEV) {
                    console.debug("[AI Cursor Tab] 拦截重复往复循环建议:", fingerprint);
                  }
                  continue;
                }

                // 防御校验：确认文档原字符与建议原字符严格匹配，且修改前后内容不能完全一致
                if (absFrom >= 0 && absTo <= latestSnap.markdown.length && absFrom <= absTo) {
                  const docSubstring = latestSnap.markdown.slice(absFrom, absTo);
                  // 剔除前后内容完全一致的建议项（无实质变更）
                  if (
                    docSubstring === item.text ||
                    (item.originalText !== undefined && item.originalText === item.text)
                  ) {
                    if (import.meta.env.DEV) {
                      console.debug(
                        `[AI Cursor Tab] 剔除前后内容完全一致的建议项: "${docSubstring}" === "${item.text}"`,
                      );
                    }
                    continue;
                  }
                  if (item.originalText && docSubstring !== item.originalText) {
                    if (import.meta.env.DEV) {
                      console.warn(
                        `[AI Cursor Tab] 防御校验丢弃幻觉项: 目标子串 "${docSubstring}" !== 原文期望 "${item.originalText}"`,
                      );
                    }
                    continue;
                  }
                  recentlyAcceptedRef.current.set(fingerprint, now);
                  items.push({
                    from: absFrom,
                    to: absTo,
                    text: item.text,
                    originalText: item.originalText,
                    explanation: item.reason,
                  });
                }
              }
            }

            if (items.length > 0) {
              if (import.meta.env.DEV) {
                console.debug(
                  `[AI Cursor Tab] ✔ 渲染流式单焦点建议 (${decision.action}, 共 ${items.length} 处预推测):`,
                  items[0],
                );
              }

              activePorts.showSuggestion({
                items,
                activeIndex: 0,
                cursorAnchor: cursorPos,
                from: items[0].from,
                to: items[0].to,
                text: items[0].text,
                originalText: items[0].originalText,
                explanation: items[0].explanation,
              });
            }

            lastAnalyzedTextRef.current = cacheKey;
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn("[AI Cursor Tab] 统一单次推理发生异常:", error);
            }
          } finally {
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          }
        },
        settings.ai.provider === "local" ? 400 : 600,
      );
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (distillTimerRef.current) {
        clearTimeout(distillTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [settings.ai]);
}
