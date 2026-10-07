import React, { useEffect, useRef, useMemo } from "react";
import { CodeMirrorEditor, type CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import { createDocumentState } from "@md-editor/editor-core";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import { bridge, type MarkdownCommand } from "../bridge/index.ts";
import { extractOutline } from "../lib/plugin-renderer.ts";

export interface EditorCanvasProps {
  initialContent: string;
  onContentChange: (newContent: string) => void;
}

/**
 * 针对 Markdown 命令计算更新后的文档文本与新光标位置
 */
function computeFormattedMarkdown(
  currentMarkdown: string,
  from: number,
  to: number,
  command: MarkdownCommand,
): { nextMarkdown: string; newCursor: number } {
  const selectedText = currentMarkdown.slice(from, to);
  const before = currentMarkdown.slice(0, from);
  const after = currentMarkdown.slice(to);

  let replacement = "";
  let cursorOffset = 0;

  switch (command) {
    case "bold":
      replacement = selectedText ? `**${selectedText}**` : "****";
      cursorOffset = selectedText ? replacement.length : 2;
      break;
    case "italic":
      replacement = selectedText ? `*${selectedText}*` : "**";
      cursorOffset = selectedText ? replacement.length : 1;
      break;
    case "strikethrough":
      replacement = selectedText ? `~~${selectedText}~~` : "~~~~";
      cursorOffset = selectedText ? replacement.length : 2;
      break;
    case "inlineCode":
      replacement = selectedText ? `\`${selectedText}\`` : "``";
      cursorOffset = selectedText ? replacement.length : 1;
      break;
    case "h1":
      replacement = selectedText ? `# ${selectedText}` : "# ";
      cursorOffset = replacement.length;
      break;
    case "h2":
      replacement = selectedText ? `## ${selectedText}` : "## ";
      cursorOffset = replacement.length;
      break;
    case "h3":
      replacement = selectedText ? `### ${selectedText}` : "### ";
      cursorOffset = replacement.length;
      break;
    case "bulletList":
      replacement = selectedText ? `- ${selectedText}` : "- ";
      cursorOffset = replacement.length;
      break;
    case "orderedList":
      replacement = selectedText ? `1. ${selectedText}` : "1. ";
      cursorOffset = replacement.length;
      break;
    case "taskList":
      replacement = selectedText ? `- [ ] ${selectedText}` : "- [ ] ";
      cursorOffset = replacement.length;
      break;
    case "quote":
      replacement = selectedText ? `> ${selectedText}` : "> ";
      cursorOffset = replacement.length;
      break;
    case "codeBlock":
      replacement = selectedText ? `\n\`\`\`\n${selectedText}\n\`\`\`\n` : "\n```\n\n```\n";
      cursorOffset = selectedText ? replacement.length : 5;
      break;
    default:
      return { nextMarkdown: currentMarkdown, newCursor: to };
  }

  const nextMarkdown = `${before}${replacement}${after}`;
  const newCursor = from + cursorOffset;
  return { nextMarkdown, newCursor };
}

export const EditorCanvas: React.FC<EditorCanvasProps> = ({ initialContent, onContentChange }) => {
  const portsRef = useRef<CodeMirrorEditorPorts | null>(null);
  const contentRef = useRef(initialContent);
  contentRef.current = initialContent;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // iOS 组合输入（IME）守卫：拼字期间既不向原生上报、也不响应视口重排。
  // 原因：WebKit 在组合期一旦被重排或让原生 UI 重建，就会把 pre-edit（拼音）
  // 当作普通文本提交，表现为"确认候选词时拼音被写进编辑区 + 光标乱跳"，
  // 因此这些副作用统一推迟到组合结束（isComposing 转 false）后执行。
  const deferredTaskRef = useRef<(() => void) | null>(null);
  const deferredTimerRef = useRef<number | null>(null);

  /** 组合期间调用：记下待执行副作用，组合结束后再跑（同刻多次调用只保留最后一次） */
  const runAfterComposition = (task: () => void) => {
    deferredTaskRef.current = task;
    if (deferredTimerRef.current !== null) return;
    const tick = () => {
      if (portsRef.current?.isComposing()) {
        deferredTimerRef.current = window.setTimeout(tick, 120);
        return;
      }
      deferredTimerRef.current = null;
      const pending = deferredTaskRef.current;
      deferredTaskRef.current = null;
      pending?.();
    };
    deferredTimerRef.current = window.setTimeout(tick, 120);
  };

  // 1. 初始化核心状态机 DocumentState（仅挂载时初始化一次）
  const docState = useMemo(() => {
    return createDocumentState({
      markdown: initialContent,
      mode: "wysiwyg",
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. 语法插件列表（包含高亮、容器指令、KaTeX 公式与 Mermaid 图表）
  const plugins = useMemo(
    () => [highlightPlugin, containerDirectivePlugin, mathPlugin, mermaidPlugin],
    [],
  );

  // 3. 订阅 DocumentState 的快照变化，同步至移动端 Bridge 与原生大纲
  useEffect(() => {
    // 首次挂载通知大纲
    bridge.notifyOutline(extractOutline(contentRef.current));

    const unsubscribe = docState.subscribeSnapshot(() => {
      const currentMarkdown = docState.getSnapshot().markdown;
      if (currentMarkdown !== contentRef.current) {
        contentRef.current = currentMarkdown;
        onContentChangeRef.current(currentMarkdown);

        // 原生上报（字数/大纲）在组合期推迟：iOS 上原生 UI 中途重建会打断 IME
        const notifyNative = () => {
          bridge.notifyContentChange({
            isDirty: true,
            wordCount: currentMarkdown.trim().length,
          });
          bridge.notifyOutline(extractOutline(currentMarkdown));
        };
        if (portsRef.current?.isComposing()) {
          runAfterComposition(notifyNative);
        } else {
          notifyNative();
        }
      }
    });

    return () => {
      unsubscribe();
      if (deferredTimerRef.current !== null) {
        window.clearTimeout(deferredTimerRef.current);
        deferredTimerRef.current = null;
      }
      deferredTaskRef.current = null;
    };
  }, [docState]);

  // 4. 注册执行原生端发来的格式化命令
  useEffect(() => {
    const cleanupExecCommand = bridge.onAction<{ command: MarkdownCommand }>(
      "execCommand",
      ({ command }) => {
        const ports = portsRef.current;
        if (!ports) return;
        bridge.triggerHaptic("impactLight");

        const sel = ports.getSelectionSnapshot();
        const snapshot = docState.getSnapshot();
        const currentMd = snapshot.markdown;
        const { nextMarkdown, newCursor } = computeFormattedMarkdown(
          currentMd,
          sel.from,
          sel.to,
          command,
        );

        if (nextMarkdown !== currentMd) {
          const result = ports.applyExternalEdit({
            operationId: `mobile:${command}:${Date.now()}`,
            markdown: nextMarkdown,
            expectedGeneration: snapshot.documentGeneration,
            expectedContentRevision: snapshot.contentRevision,
            selection: "preserve-offset-clamped",
          });

          if (result.status === "applied") {
            contentRef.current = nextMarkdown;
            ports.setSelection(newCursor, newCursor);
            ports.focus();
          }
        }
      },
    );

    // 5. 注册原生请求最新内容监听 (保存回写)
    const cleanupRequestContent = bridge.onAction("requestContent", () => {
      portsRef.current?.flushPendingEdits();
      bridge.respondSaveContent(docState.getSnapshot().markdown, true);
    });

    // 6. 监听移动端 Visual Viewport 变化（iOS 键盘/候选栏弹动）
    // 组合期推迟重排：重排会让 WebKit 提前提交 pre-edit，表现为拼音直落编辑区
    const handleViewportResize = () => {
      if (portsRef.current?.isComposing()) {
        runAfterComposition(() => portsRef.current?.requestMeasure());
        return;
      }
      portsRef.current?.requestMeasure();
    };
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      cleanupExecCommand();
      cleanupRequestContent();
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [docState]);

  return (
    <div className="editor-container">
      <CodeMirrorEditor
        document={docState}
        plugins={plugins}
        onRendererPortsChange={(ports) => {
          portsRef.current = ports;
          if (ports) {
            // 在动画帧微任务中延迟安全执行 focus，避免 DOM layout 未完成时强制聚焦引起异常
            requestAnimationFrame(() => {
              try {
                ports.focus();
              } catch (err) {
                console.warn("[EditorCanvas] Safe focus failed:", err);
              }
            });
          }
        }}
      />
    </div>
  );
};
