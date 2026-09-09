import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentState,
} from "@md-editor/editor-core";
import { EditorUiProvider, type CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import { WebHeader } from "./components/WebHeader";
import { WebEditor } from "./components/WebEditor";
import { WebOutlineDrawer } from "./components/WebOutlineDrawer";
import { WebSettingsDialog } from "./components/WebSettingsDialog";
import { DEFAULT_SHOWCASE_MARKDOWN } from "./presets/showcase";
import { exportMarkdown, copyMarkdown } from "./lib/export-helper";
import {
  clearSavedDraft,
  loadSavedDraft,
  loadWebSettings,
  saveDraft,
  saveWebSettings,
  type WebSettings,
  type WebTheme,
} from "./lib/web-settings";
import { requestWebAiContinuation } from "./lib/web-ai-client";
import { applyDesktopTheme } from "./lib/theme-manager";
import { bindWebKeyboardShortcuts } from "./lib/keyboard-shortcuts";
import { useTranslation, changeLanguage } from "@md-editor/i18n";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<WebSettings>(() => loadWebSettings());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOutlineOpen, setIsOutlineOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);

  // 初始化 DocumentState
  const initialMarkdown = useMemo(() => {
    return loadSavedDraft() || DEFAULT_SHOWCASE_MARKDOWN;
  }, []);

  const [documentState] = useState<DocumentState>(() =>
    createDocumentState({ markdown: initialMarkdown }),
  );

  const [currentMarkdown, setCurrentMarkdown] = useState(initialMarkdown);
  const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");

  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const showToast = useCallback((msg: string | null) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    if (msg) {
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
    }
  }, []);

  // 监听文档变更，防抖暂存至 localStorage
  useEffect(() => {
    const unsubscribe = documentState.subscribeTransitions((event) => {
      const snap = documentState.getSnapshot();
      setCurrentMarkdown(snap.markdown);
      setMode(snap.mode);
      if (event.transition.kind === "content") {
        saveDraft(snap.markdown);
      }
    });
    return () => unsubscribe();
  }, [documentState]);

  // 同步多语言设置
  useEffect(() => {
    changeLanguage(settings.language);
  }, [settings.language]);

  // 复用桌面端真实主题 CSS 变量与色彩模式
  useEffect(() => {
    return applyDesktopTheme(settings);
  }, [settings]);

  // 模式切换
  const handleChangeMode = useCallback(
    (newMode: "wysiwyg" | "source") => {
      if (ports) {
        const res = switchEditorModeSafely(documentState, newMode, {
          operationId: `web:mode:${Date.now()}`,
          renderer: ports.mode,
          origin: { kind: "command", commandId: "view.toggleSource" },
        });
        if (!res.ok) {
          showToast(res.message);
          return;
        }
      }
      setMode(newMode);
    },
    [ports, documentState, showToast],
  );

  // 切换主题
  const handleToggleTheme = () => {
    const nextTheme: WebTheme = settings.theme === "dark" ? "light" : "dark";
    const nextSettings: WebSettings = { ...settings, theme: nextTheme };
    setSettings(nextSettings);
    saveWebSettings(nextSettings);
  };

  // 保存当前文档至本地存储 (localStorage)
  const handleSaveToStorage = useCallback(() => {
    const snap = documentState.getSnapshot();
    saveDraft(snap.markdown);
    showToast(t("toasts.docSavedToStorage"));
  }, [documentState, showToast, t]);

  // 导出 Markdown 文件
  const handleExport = useCallback(() => {
    exportMarkdown(currentMarkdown, "inkpoint-document.md");
    showToast(t("toasts.exportedDoc", { filename: "inkpoint-document.md" }));
  }, [currentMarkdown, showToast, t]);

  // 复制 Markdown 到剪贴板
  const handleCopy = async () => {
    const ok = await copyMarkdown(currentMarkdown);
    if (ok) {
      setIsCopied(true);
      showToast(t("toasts.copySuccess"));
      setTimeout(() => setIsCopied(false), 2000);
    } else {
      showToast(t("toasts.copyFailed"));
    }
  };

  // 恢复为默认演示内容
  const handleReset = () => {
    clearSavedDraft();
    documentState.replaceDocument(
      {
        markdown: DEFAULT_SHOWCASE_MARKDOWN,
        savedMarkdown: DEFAULT_SHOWCASE_MARKDOWN,
        filePath: null,
      },
      { kind: "command", commandId: "web.reset" },
    );
    showToast(t("toasts.demoReset"));
  };

  // 主动触发 AI 智能续写
  const handleTriggerAi = async () => {
    if (!settings.ai.enabled) {
      showToast(t("toasts.aiNotEnabled"));
      setIsSettingsOpen(true);
      return;
    }
    if (!settings.ai.baseUrl) {
      showToast(t("toasts.aiConfigureBaseUrl"));
      setIsSettingsOpen(true);
      return;
    }
    if (!settings.ai.apiKey && settings.ai.provider !== "ollama") {
      showToast(t("toasts.aiConfigureApiKey"));
      setIsSettingsOpen(true);
      return;
    }

    if (!ports) {
      showToast(t("toasts.editorInitializing"));
      return;
    }

    const selection = ports.getSelectionSnapshot();
    const cursorPos = selection.from;
    const before = currentMarkdown.slice(0, cursorPos);
    const after = currentMarkdown.slice(cursorPos);

    showToast(t("toasts.aiThinking"));

    try {
      const continuation = await requestWebAiContinuation(settings.ai, before, after);

      if (!continuation) {
        showToast(t("toasts.aiNoSuggestion"));
        return;
      }

      // 将建议注入 CM6 渲染层（呈现浅灰色 Ghost Text）
      ports.showSuggestion({
        items: [
          {
            from: cursorPos,
            to: cursorPos,
            text: continuation,
          },
        ],
        activeIndex: 0,
        from: cursorPos,
        to: cursorPos,
        text: continuation,
      });

      showToast(t("toasts.aiSuggestionGenerated"));
    } catch (err) {
      console.error(err);
      showToast(t("toasts.aiRequestFailed"));
    }
  };

  const handleTriggerAiRef = useRef(handleTriggerAi);
  handleTriggerAiRef.current = handleTriggerAi;

  // 绑定 Web 快捷键系统（Mod-/ 模式切换、Mod-Shift-B 大纲、Mod-, 设置、Mod-s 保存草稿、Mod-Shift-A / Mod-j AI 续写、Escape 关闭）
  useEffect(() => {
    return bindWebKeyboardShortcuts({
      onToggleMode: () => {
        handleChangeMode(mode === "wysiwyg" ? "source" : "wysiwyg");
      },
      onToggleOutline: () => {
        setIsOutlineOpen((prev) => !prev);
      },
      onOpenSettings: () => {
        setIsSettingsOpen(true);
      },
      onSave: () => {
        handleSaveToStorage();
      },
      onTriggerAi: () => {
        void handleTriggerAiRef.current();
      },
      onCloseOverlay: () => {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else if (isOutlineOpen) {
          setIsOutlineOpen(false);
        } else {
          ports?.dismissSuggestion();
        }
      },
    });
  }, [mode, isSettingsOpen, isOutlineOpen, ports, handleSaveToStorage, handleChangeMode]);

  return (
    <EditorUiProvider markdown={currentMarkdown} showToast={showToast}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--theme-bg)] text-[var(--theme-text)]">
        {/* 顶部导航栏（无文件树，仅 Logo、明暗与设置） */}
        <WebHeader
          theme={settings.theme}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* 主编辑区域（全宽沉浸式无文件树界面） */}
        <main className="relative flex min-h-0 flex-1 overflow-hidden">
          <WebEditor
            document={documentState}
            settings={settings}
            onRendererPortsChange={setPorts}
          />

          {/* 右侧大纲抽屉 */}
          <WebOutlineDrawer open={isOutlineOpen} onClose={() => setIsOutlineOpen(false)} />
        </main>

        {/* 浮动 Toast 提示 */}
        {toastMessage && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-xs font-medium text-[var(--theme-title)] shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2">
            {toastMessage}
          </div>
        )}

        {/* 弹窗设置面板（包含 AI 助手配置、外观主题、模式切换、快捷键速查与文档输出） */}
        <WebSettingsDialog
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onSaveSettings={(newSettings) => {
            setSettings(newSettings);
            saveWebSettings(newSettings);
            showToast(t("settings.saveSuccessToast"));
          }}
          mode={mode}
          onChangeMode={handleChangeMode}
          onExport={handleExport}
          onCopy={handleCopy}
          isCopied={isCopied}
          onReset={handleReset}
        />
      </div>
    </EditorUiProvider>
  );
}
