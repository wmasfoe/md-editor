/**
 * @file use-utools-ai.ts
 * @description
 * uTools 端 AI 助写交互 Hook。
 * 封装：
 * 1. 第三方宿主环境免责声明弹窗状态管理；
 * 2. 行内续写 (Ghost Text) 触发逻辑与端口建议注入；
 * 3. 语法错别字审校触发逻辑与 Quad-Layer Diff 建议注入。
 */

import { useCallback, useState } from "react";
import type { CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import { shouldSkipAutoGec } from "@md-editor/ai";
import { utoolsAiService } from "./ai-service";
import { acceptAiDisclaimer, hasAcceptedAiDisclaimer } from "./ai-disclaimer";
import type { UtoolsSettings } from "./db-storage";

export interface UseUtoolsAiOptions {
  readonly settings: UtoolsSettings;
  readonly getEditorPorts: () => CodeMirrorEditorPorts | null;
  readonly getMarkdown: () => string;
  readonly getEditorMode?: () => "wysiwyg" | "source";
  readonly showToast: (message: string) => void;
  readonly onOpenSettings: () => void;
}

export function useUtoolsAi({
  settings,
  getEditorPorts,
  getMarkdown,
  getEditorMode,
  showToast,
  onOpenSettings,
}: UseUtoolsAiOptions) {
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [pendingAiAction, setPendingAiAction] = useState<"continuation" | "gec" | null>(null);

  const openDisclaimer = useCallback(() => {
    setIsDisclaimerOpen(true);
  }, []);

  const closeDisclaimer = useCallback(() => {
    setIsDisclaimerOpen(false);
    setPendingAiAction(null);
  }, []);

  const triggerContinuation = useCallback(async () => {
    if (!hasAcceptedAiDisclaimer()) {
      setPendingAiAction("continuation");
      setIsDisclaimerOpen(true);
      return;
    }

    const readiness = utoolsAiService.checkReadiness(settings.ai, "continuation");
    if (readiness) {
      showToast(readiness);
      onOpenSettings();
      return;
    }

    const ports = getEditorPorts();
    if (!ports) {
      showToast("编辑器未就绪。");
      return;
    }

    const selection = ports.getSelectionSnapshot();
    const markdown = getMarkdown();
    const cursorPos = selection.from;
    const before = markdown.slice(0, cursorPos);
    const after = markdown.slice(cursorPos);

    showToast("AI 续写思考中...");

    try {
      const result = await utoolsAiService.continueWriting(
        settings.ai,
        {
          before,
          after,
          selectedText: selection.text,
          mode: getEditorMode ? getEditorMode() : "wysiwyg",
        },
        { isGhostText: false },
      );

      if (!result.continuation) {
        showToast("未能生成有效续写建议。");
        return;
      }

      ports.showSuggestion({
        items: [{ from: cursorPos, to: cursorPos, text: result.continuation }],
        activeIndex: 0,
        from: cursorPos,
        to: cursorPos,
        text: result.continuation,
      });
    } catch (err) {
      console.error(err);
      showToast("AI 请求失败，请检查网络或 API 配置。");
    }
  }, [settings.ai, getEditorPorts, getMarkdown, showToast, onOpenSettings, getEditorMode]);

  const triggerGrammarFix = useCallback(async () => {
    if (!hasAcceptedAiDisclaimer()) {
      setPendingAiAction("gec");
      setIsDisclaimerOpen(true);
      return;
    }

    const readiness = utoolsAiService.checkReadiness(settings.ai, "editing");
    if (readiness) {
      showToast(readiness);
      onOpenSettings();
      return;
    }

    const ports = getEditorPorts();
    if (!ports) {
      showToast("编辑器未就绪。");
      return;
    }

    const selection = ports.getSelectionSnapshot();
    const markdown = getMarkdown();
    let targetFrom = selection.from;
    let targetTo = selection.to;
    let selectedText = selection.text;

    // 若未选中，则自动定位当前句子/行
    if (targetFrom === targetTo) {
      const lineStart = markdown.lastIndexOf("\n", targetFrom - 1) + 1;
      const lineEndIndex = markdown.indexOf("\n", targetFrom);
      const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
      if (lineEnd > lineStart) {
        targetFrom = lineStart;
        targetTo = lineEnd;
        selectedText = markdown.slice(lineStart, lineEnd);
      }
    }

    const before = markdown.slice(0, targetFrom);
    const after = markdown.slice(targetTo);
    const currentLineText = selectedText.trim();

    if (shouldSkipAutoGec(selectedText, before)) {
      showToast("当前光标位置属于代码块、表格或特殊符号，跳过审校。");
      return;
    }

    showToast("AI 语法修复分析中...");

    try {
      const result = await utoolsAiService.fixGrammar(settings.ai, {
        before,
        after,
        selectedText: currentLineText,
        mode: getEditorMode ? getEditorMode() : "wysiwyg",
      });

      if (!result.hasEdit || !result.edit || !result.edit.replacement) {
        showToast("未发现明显语法、错别字或标点问题。");
        return;
      }

      const diffs =
        result.edit.diffs && result.edit.diffs.length > 0
          ? result.edit.diffs
          : [
              {
                original: result.edit.original,
                replacement: result.edit.replacement,
                utf16From: result.edit.utf16From,
                utf16To: result.edit.utf16To,
              },
            ];

      const leadingSpaces = selectedText.length - selectedText.trimStart().length;
      const lineContentStart = targetFrom + leadingSpaces;

      const items = diffs
        .map((diff) => {
          let itemFrom = lineContentStart;
          let itemTo = targetTo;
          const originalText = diff.original;

          if (typeof diff.utf16From === "number" && typeof diff.utf16To === "number") {
            itemFrom = lineContentStart + diff.utf16From;
            itemTo = lineContentStart + diff.utf16To;
          } else if (diff.original && currentLineText.includes(diff.original)) {
            const offset = currentLineText.indexOf(diff.original);
            itemFrom = lineContentStart + offset;
            itemTo = itemFrom + diff.original.length;
          }

          return {
            from: itemFrom,
            to: itemTo,
            text: diff.replacement,
            originalText,
            explanation: result.edit?.reason,
          };
        })
        .filter(
          (item) => item.from <= item.to && item.text.length > 0 && item.originalText !== item.text,
        );

      if (items.length > 0) {
        ports.showSuggestion({
          items,
          activeIndex: 0,
          from: items[0].from,
          to: items[0].to,
          text: items[0].text,
          originalText: items[0].originalText,
          explanation: items[0].explanation,
        });
        showToast(
          items[0].explanation
            ? `AI 建议：${items[0].explanation}（Tab 接受 · Esc 取消）`
            : "AI 修复建议已就绪，按 Tab 接受，Esc 取消。",
        );
      } else {
        showToast("未发现明显语法、错别字或标点问题。");
      }
    } catch (err) {
      console.error(err);
      showToast("AI 请求失败，请检查网络或 API 配置。");
    }
  }, [settings.ai, getEditorPorts, getMarkdown, showToast, onOpenSettings, getEditorMode]);

  const handleAcceptDisclaimer = useCallback(() => {
    acceptAiDisclaimer();
    setIsDisclaimerOpen(false);
    const action = pendingAiAction;
    setPendingAiAction(null);
    if (action === "continuation") {
      void triggerContinuation();
    } else if (action === "gec") {
      void triggerGrammarFix();
    }
  }, [pendingAiAction, triggerContinuation, triggerGrammarFix]);

  return {
    isDisclaimerOpen,
    openDisclaimer,
    closeDisclaimer,
    handleAcceptDisclaimer,
    triggerContinuation,
    triggerGrammarFix,
  };
}
