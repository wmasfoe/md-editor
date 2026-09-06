"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createDocumentState, type DocumentState } from "@md-editor/editor-core";
import {
  CodeMirrorEditor,
  EditorUiProvider,
  type CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import { SHOWCASE_AI_FLOW_DATA, type AiShowcaseStage } from "./showcase-ai-samples";

export interface AiShowcaseFlowState {
  readonly stage: AiShowcaseStage | "completed";
  readonly grammarIndex: number;
  readonly grammarTotal: number;
  readonly continuationIndex: number;
  readonly continuationTotal: number;
  readonly isFinished: boolean;
  readonly isDismissed: boolean;
}

export interface AiShowcaseEditorHandle {
  focus: () => void;
  accept: () => void;
  dismiss: () => void;
  retrigger: () => void;
  reset: () => void;
  jumpToStage: (targetStage: AiShowcaseStage) => void;
}

export interface AiShowcaseEditorProps {
  readonly isZh: boolean;
  readonly onStateChange?: (state: AiShowcaseFlowState) => void;
}

const EDITOR_STYLES: React.CSSProperties = {
  "--theme-surface": "#ffffff",
  "--theme-bg": "#faf9f6",
  "--theme-text": "#14120f",
  "--theme-title": "#14120f",
  "--theme-muted": "#7a736a",
  "--theme-border": "#e8e4dc",
  "--theme-primary": "#1f6feb",
  "--theme-primary-fill": "#1f6feb",
  "--theme-primary-soft": "rgba(31, 111, 235, 0.08)",
  "--theme-danger-bg": "rgba(207, 34, 46, 0.1)",
  "--theme-danger-text": "#cf222e",
  "--theme-code-string": "#2e7d32",
  "--theme-code": "#2e2a25",
  "--theme-code-bg": "#f5f3ec",
  "--theme-code-border": "#e4e0d7",
  "--theme-font":
    'var(--font-inter), "LXGW WenKai", "LXGW WenKai Screen", "霞鹜文楷", system-ui, sans-serif',
  "--theme-mono-font": '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
  "--theme-editor-line-height": "1.9",
} as React.CSSProperties;

export const AiShowcaseEditor = forwardRef<AiShowcaseEditorHandle, AiShowcaseEditorProps>(
  function AiShowcaseEditor({ isZh, onStateChange }, ref) {
    const flowData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];

    // 纯内存文档状态
    const [documentState] = useState<DocumentState>(() =>
      createDocumentState({
        markdown: flowData.initialMarkdown,
        mode: "wysiwyg",
      }),
    );

    const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);
    const portsRef = useRef<CodeMirrorEditorPorts | null>(null);
    portsRef.current = ports;

    // 两阶段流转内部状态
    const stageRef = useRef<AiShowcaseStage | "completed">("grammar");
    const grammarIndexRef = useRef(0);
    const continuationIndexRef = useRef(0);
    const isDismissedRef = useRef(false);

    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;

    const noopToast = useCallback(() => {}, []);

    const emitState = useCallback(() => {
      const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];
      onStateChangeRef.current?.({
        stage: stageRef.current,
        grammarIndex: grammarIndexRef.current,
        grammarTotal: activeData.grammarItems.length,
        continuationIndex: continuationIndexRef.current,
        continuationTotal: activeData.continuationSteps.length,
        isFinished: stageRef.current === "completed",
        isDismissed: isDismissedRef.current,
      });
    }, [isZh]);

    // 启动 Phase 1 语法与标点审校
    const startPhase1 = useCallback(
      (activePorts: CodeMirrorEditorPorts) => {
        const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];
        stageRef.current = "grammar";
        grammarIndexRef.current = 0;
        continuationIndexRef.current = 0;
        isDismissedRef.current = false;

        documentState.replaceDocument(
          {
            markdown: activeData.initialMarkdown,
            savedMarkdown: activeData.initialMarkdown,
            filePath: null,
            mode: "wysiwyg",
          },
          { kind: "command", commandId: "ai.showcase.phase1" },
        );

        activePorts.showSuggestion({
          items: activeData.grammarItems,
          activeIndex: 0,
        });

        emitState();
      },
      [documentState, isZh, emitState],
    );

    // 启动 Phase 2 行内灵犀续写（无缝接在当前文档末尾，或以纯续写起手文稿启动）
    const startPhase2 = useCallback(
      (activePorts: CodeMirrorEditorPorts, standalone = false) => {
        const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];
        stageRef.current = "continuation";
        continuationIndexRef.current = 0;
        isDismissedRef.current = false;

        if (standalone) {
          grammarIndexRef.current = activeData.grammarItems.length;
          documentState.replaceDocument(
            {
              markdown: activeData.continuationOnlyMarkdown,
              savedMarkdown: activeData.continuationOnlyMarkdown,
              filePath: null,
              mode: "wysiwyg",
            },
            { kind: "command", commandId: "ai.showcase.phase2.standalone" },
          );
        }

        const currentLen = documentState.getSnapshot().markdown.length;
        // 将光标对齐至文末，确保光标与幽灵文本紧密贴合
        activePorts.setSelection(currentLen, currentLen);

        const firstStep = activeData.continuationSteps[0];
        if (firstStep) {
          activePorts.showSuggestion({
            from: currentLen,
            to: currentLen,
            text: firstStep.text,
          });
        }

        emitState();
      },
      [documentState, isZh, emitState],
    );

    // 重置并启动完整两阶段连贯流
    const resetFlow = useCallback(() => {
      const activePorts = portsRef.current;
      if (!activePorts) {
        return;
      }
      startPhase1(activePorts);
    }, [startPhase1]);

    // 当 ports 挂载就绪或语言切换时，启动流程
    useEffect(() => {
      if (!ports) {
        return;
      }
      resetFlow();
    }, [ports, isZh, resetFlow]);

    // 监听文档内容更新，推进两阶段状态机
    useEffect(() => {
      const unsubscribe = documentState.subscribeTransitions((event) => {
        const activePorts = portsRef.current;
        if (!activePorts) {
          return;
        }
        if (event.transition.kind !== "content") {
          return;
        }

        const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];

        if (stageRef.current === "grammar") {
          // 检查当前审校队列
          const suggestion = activePorts.getSuggestion();
          if (!suggestion) {
            // 阶段 1 全部审校完毕！立即在当前文档末尾无缝点亮阶段 2 续写幽灵文本
            grammarIndexRef.current = activeData.grammarItems.length;
            startPhase2(activePorts, false);
          } else {
            grammarIndexRef.current = suggestion.activeIndex;
            emitState();
          }
        } else if (stageRef.current === "continuation") {
          // 用户刚刚在续写阶段采纳了一步
          const nextStepIdx = continuationIndexRef.current + 1;
          continuationIndexRef.current = nextStepIdx;

          const totalSteps = activeData.continuationSteps.length;
          if (nextStepIdx < totalSteps) {
            // 呈现下一步续写
            const nextStep = activeData.continuationSteps[nextStepIdx];
            const currentDocLen = documentState.getSnapshot().markdown.length;
            activePorts.showSuggestion({
              from: currentDocLen,
              to: currentDocLen,
              text: nextStep.text,
            });
            emitState();
          } else {
            // 全部 3 步续写完成，进入完稿状态
            stageRef.current = "completed";
            emitState();
          }
        }
      });

      return () => {
        unsubscribe();
      };
    }, [documentState, isZh, startPhase2, emitState]);

    // 处理驳回建议逻辑
    const handleDismiss = useCallback(() => {
      const activePorts = portsRef.current;
      if (!activePorts) {
        return;
      }

      if (stageRef.current === "grammar") {
        activePorts.dismissSuggestion();
        const sugg = activePorts.getSuggestion();
        const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];
        if (!sugg) {
          // 语法项全部跳过，自动进入续写
          grammarIndexRef.current = activeData.grammarItems.length;
          startPhase2(activePorts, false);
        } else {
          grammarIndexRef.current = sugg.activeIndex;
          emitState();
        }
      } else if (stageRef.current === "continuation") {
        activePorts.dismissSuggestion();
        isDismissedRef.current = true;
        emitState();
      }
    }, [isZh, startPhase2, emitState]);

    // 处理重新获取建议逻辑
    const handleRetrigger = useCallback(() => {
      const activePorts = portsRef.current;
      if (!activePorts) {
        return;
      }

      const activeData = SHOWCASE_AI_FLOW_DATA[isZh ? "zh" : "en"];

      if (stageRef.current === "grammar") {
        activePorts.showSuggestion({
          items: activeData.grammarItems,
          activeIndex: grammarIndexRef.current,
        });
        isDismissedRef.current = false;
        emitState();
        activePorts.focus();
      } else if (stageRef.current === "continuation") {
        const currentLen = documentState.getSnapshot().markdown.length;
        activePorts.setSelection(currentLen, currentLen);
        const step = activeData.continuationSteps[continuationIndexRef.current];
        if (step) {
          activePorts.showSuggestion({
            from: currentLen,
            to: currentLen,
            text: step.text,
          });
        }
        isDismissedRef.current = false;
        emitState();
        activePorts.focus();
      }
    }, [documentState, isZh, emitState]);

    // 暴露给父组件的受控操作
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          portsRef.current?.focus();
        },
        accept: () => {
          portsRef.current?.acceptSuggestion();
        },
        dismiss: () => {
          handleDismiss();
        },
        retrigger: () => {
          handleRetrigger();
        },
        reset: () => {
          resetFlow();
        },
        jumpToStage: (targetStage: AiShowcaseStage) => {
          const activePorts = portsRef.current;
          if (!activePorts) {
            return;
          }
          if (targetStage === "grammar") {
            startPhase1(activePorts);
          } else {
            startPhase2(activePorts, true);
          }
        },
      }),
      [handleDismiss, handleRetrigger, resetFlow, startPhase1, startPhase2],
    );

    return (
      <EditorUiProvider markdown={flowData.initialMarkdown} showToast={noopToast}>
        <div
          style={EDITOR_STYLES}
          onMouseDown={() => {
            // 点击编辑器工作区时，确保焦点进入 CodeMirror
            portsRef.current?.focus();
          }}
          onKeyDownCapture={(e) => {
            if (e.key === "Escape") {
              // 捕获阶段拦截 Esc：避免 CodeMirror 内部处理后不通知 showcase 状态机
              if (stageRef.current === "grammar") {
                e.preventDefault();
                e.stopPropagation();
                handleDismiss();
              } else if (stageRef.current === "continuation") {
                if (!isDismissedRef.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDismiss();
                }
              }
            } else if (e.key === "Tab") {
              // 若处于跳过/已忽略状态，轻敲 Tab 重新获取建议，阻止默认缩进行为
              if (isDismissedRef.current) {
                e.preventDefault();
                e.stopPropagation();
                handleRetrigger();
              }
            }
          }}
          className="site-ai-editor-canvas min-h-[140px] sm:min-h-[160px] w-full"
        >
          <CodeMirrorEditor
            document={documentState}
            fontSize={17}
            className="site-ai-codemirror text-lg leading-[1.9] sm:text-xl"
            onRendererPortsChange={setPorts}
          />
        </div>
      </EditorUiProvider>
    );
  },
);
