// apps/utools/src/components/UtoolsApp.tsx
// uTools 插件主应用容器
// 100% 收敛在 apps/utools，复用 @md-editor/core 与 @md-editor/app-ui 核心

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createDocumentState,
  OPEN_FOLDER_SHORTCUT,
  switchEditorModeSafely,
  type DocumentState,
} from "@md-editor/core";
import {
  AppEditor,
  EditorUiProvider,
  matchesRuntimeKeymap,
  resolveCodeFontStack,
  resolveProseFontStack,
} from "@md-editor/app-ui";
import { useMarkdownLintEngine } from "@md-editor/app-ui/markdownlint";
import { type CodeMirrorEditorPorts } from "@md-editor/editor";
import { fileAccess } from "../utools/file-access";
import type { EditorMode } from "../utools/types";
import { ReferralBanner } from "./ReferralBanner";
import { DisclaimerModal } from "./DisclaimerModal";
import { SettingsModal } from "./SettingsModal";
import { useUtoolsAi } from "../utools/use-utools-ai";
import { UtoolsFileTree } from "./UtoolsFileTree";
import { UtoolsStatusBar } from "./UtoolsStatusBar";
import { useUtoolsThemeSettings } from "../utools/use-utools-theme-settings";
import { useUtoolsFileTree } from "../utools/use-utools-file-tree";
import { useUtoolsDocumentController } from "../utools/use-utools-document-controller";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";

/**
 * 与桌面端对齐的语法扩展插件列表：
 * 代码高亮 / Container Directive / KaTeX 数学公式 / Mermaid 图表
 */
const UTOOLS_SYNTAX_PLUGINS = [
  highlightPlugin,
  containerDirectivePlugin,
  mathPlugin,
  mermaidPlugin,
];

export function UtoolsApp() {
  const [_mode, setMode] = useState<EditorMode>("file");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [rendererPorts, setRendererPorts] = useState<CodeMirrorEditorPorts | null>(null);

  const {
    settings,
    settingsRef,
    isSettingsOpen,
    applyTheme,
    handleOpenSettings,
    handleCancelSettings,
    handleSaveSettings,
    handleUpdateSettings,
  } = useUtoolsThemeSettings();

  const showToast = useCallback((msg: string | null) => {
    setToastMessage(msg);
    if (msg) {
      setTimeout(() => setToastMessage(null), 2400);
    }
  }, []);

  const docState: DocumentState = useMemo(
    () =>
      createDocumentState({
        markdown: "",
        savedMarkdown: "",
        filePath: null,
        mode: "wysiwyg",
      }),
    [],
  );

  const subscribeSnapshot = useCallback(
    (onStoreChange: () => void) => docState.subscribeSnapshot(onStoreChange),
    [docState],
  );
  const getSnapshot = useCallback(() => docState.getSnapshot(), [docState]);
  const snapshot = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const { handleSaveDocument, handleNewFile, handleInsertImageFile } = useUtoolsDocumentController({
    docState,
    markdown: snapshot.markdown,
    setMode,
    setFolder: (f) => fileTree.setFolder(f),
    folderRef: {
      get current() {
        return fileTree.folderRef.current;
      },
      set current(v) {
        fileTree.folderRef.current = v;
      },
    },
    rendererPorts,
    showToast,
  });

  const fileTree = useUtoolsFileTree({
    docState,
    setMode,
    setIsSidebarOpen,
    showToast,
  });

  const ai = useUtoolsAi({
    settings,
    getEditorPorts: () => rendererPorts,
    getMarkdown: () => snapshotRef.current.markdown,
    getEditorMode: () => snapshotRef.current.mode,
    showToast,
    onOpenSettings: handleOpenSettings,
  });

  const toggleSourceMode = useCallback(() => {
    if (!rendererPorts) {
      showToast("编辑器未就绪");
      return;
    }
    const currentMode = snapshot.mode;
    const nextMode = currentMode === "source" ? "wysiwyg" : "source";
    const result = switchEditorModeSafely(docState, nextMode, {
      operationId: `utools:mode:${Date.now()}`,
      renderer: rendererPorts.mode,
      origin: { kind: "command", commandId: "view.toggleSource" },
    });
    if (!result.ok) {
      showToast(`切换失败: ${result.message}`);
    }
  }, [docState, rendererPorts, showToast, snapshot.mode]);

  const { showDocument, showWorkspace } = fileTree;
  useEffect(
    () =>
      fileAccess.subscribeLifecycle(
        (entry) => {
          applyTheme(settingsRef.current.theme);
          try {
            if (entry.error) throw new Error(entry.error);
            if (entry.document) {
              showDocument(entry.document);
            } else if (entry.folder) {
              showWorkspace(entry.folder);
            } else if (entry.code === "workspace") {
              setIsSidebarOpen(true);
            } else if (entry.text) {
              fileAccess.closeDocument();
              docState.replaceDocument(
                {
                  markdown: entry.text,
                  savedMarkdown: "",
                  filePath: null,
                  mode: snapshotRef.current.mode,
                },
                { kind: "command", commandId: "utools.selectionEdit" },
              );
              setMode("selection");
              setIsSidebarOpen(false);
            }
          } catch (error) {
            showToast(`打开失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        () => {
          const current = docState.getSnapshot();
          if (current.filePath && current.isDirty) {
            try {
              fileAccess.saveMarkdown(current.filePath, current.markdown);
            } catch (error) {
              console.warn("退出时保存失败", error);
            }
          }
        },
      ),
    [applyTheme, docState, settingsRef, showDocument, showWorkspace, showToast],
  );

  // 贴回原应用
  const handlePasteBackToApp = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
      window.utools.hideMainWindowPasteText(snapshot.markdown);
    }
  }, [snapshot.markdown]);

  // 监听剪贴板粘贴图片与拖拽图片事件
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;
      for (const item of Array.from(clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            e.stopPropagation();
            void handleInsertImageFile(file);
            return;
          }
        }
      }
    };

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };

    const handleDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          void handleInsertImageFile(file);
          return;
        }
      }
    };

    window.addEventListener("paste", handlePaste, { capture: true });
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("paste", handlePaste, { capture: true });
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleInsertImageFile]);

  const resolveImage = useCallback(
    (src: string) => fileAccess.resolveImage(docState.getSnapshot().filePath, src),
    [docState],
  );

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSettingsOpen) {
          handleCancelSettings();
          return;
        }
        if (ai.isDisclaimerOpen) {
          ai.closeDisclaimer();
          return;
        }
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      if (e.key === "," || key === ",") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleOpenSettings();
        return;
      }

      if (e.key === "/" || key === "/") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleSourceMode();
        return;
      }

      if (key === "1" && !e.shiftKey && !e.altKey) {
        if (snapshotRef.current.mode === "source") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          toggleSourceMode();
          return;
        }
      }

      if ((key === "b" && e.shiftKey) || e.key === "\\" || key === "\\") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      if (key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleNewFile();
        return;
      }

      // Mod-Alt-O 打开文件夹；Mod-Shift-O 留给有序列表，这里不能 preventDefault。
      if (matchesRuntimeKeymap(e, OPEN_FOLDER_SHORTCUT)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        fileTree.handleOpenFolder();
        return;
      }

      if (matchesRuntimeKeymap(e, "Mod-o")) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        fileTree.handleOpenFile();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handlePasteBackToApp();
        return;
      }

      if (key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void handleSaveDocument();
        return;
      }

      if ((key === "j" && !e.shiftKey) || (key === "a" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void ai.triggerContinuation();
        return;
      }

      if (key === "g" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void ai.triggerGrammarFix();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    ai,
    fileTree,
    handleNewFile,
    handlePasteBackToApp,
    handleSaveDocument,
    handleCancelSettings,
    handleOpenSettings,
    isSettingsOpen,
    toggleSourceMode,
  ]);

  const markdownlint = useMarkdownLintEngine();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--theme-bg)] text-[var(--theme-text)]">
      {/* 顶部导流横幅 */}
      <ReferralBanner />

      {/* 主工作区：左侧文件树抽屉 + 右侧编辑器 */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {isSidebarOpen && (
          <UtoolsFileTree
            folder={fileTree.folder}
            activeFilePath={snapshot.filePath}
            onSelectFile={fileTree.handleSelectTreeFile}
            onCreateItem={fileTree.handleCreateTreeItem}
            onRenameItem={fileTree.handleRenameTreeItem}
            onDeleteNode={fileTree.handleDeleteTreeNode}
            onRefresh={fileTree.handleRefreshFolder}
            onToast={showToast}
            onCloseFolder={() => {
              fileTree.setFolder(null);
              setIsSidebarOpen(false);
              fileAccess.closeWorkspace();
            }}
            onOpenFolder={fileTree.handleOpenFolder}
          />
        )}

        {/* 编辑器核心区域 */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative select-text">
          <EditorUiProvider markdown={snapshot.markdown} showToast={showToast}>
            <AppEditor
              document={docState}
              codeBlockLineNumbers={settings.showCodeBlockLineNumbers}
              showInlineStyleMarkers={settings.showInlineStyleMarkers}
              enableMarkdownLint={Boolean(markdownlint) && settings.enableMarkdownLint}
              markdownlint={markdownlint}
              theme={{
                typography: {
                  fontSize: settings.fontSize,
                  proseFontFamily: resolveProseFontStack(settings.proseFontFamily),
                  codeFontFamily: resolveCodeFontStack(settings.codeFontFamily),
                },
              }}
              resolveImageSrc={resolveImage}
              plugins={UTOOLS_SYNTAX_PLUGINS}
              className="flex-1 min-h-0 w-full"
              ariaLabel="Inkpoint Markdown 编辑器"
              onRendererPortsChange={setRendererPorts}
            />
          </EditorUiProvider>
        </main>
      </div>

      {/* 底部多功能状态栏 */}
      <UtoolsStatusBar
        filePath={snapshot.filePath}
        isDirty={snapshot.isDirty}
        folder={fileTree.folder}
        isSidebarOpen={isSidebarOpen}
        charCount={snapshot.markdown.length}
        editorMode={snapshot.mode}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onNewFile={handleNewFile}
        onOpenFile={fileTree.handleOpenFile}
        onOpenFolder={fileTree.handleOpenFolder}
        onToggleSourceMode={toggleSourceMode}
        onOpenSettings={handleOpenSettings}
      />

      {/* 轻量 Toast 提示 */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-[var(--theme-title)] text-[var(--theme-surface)] text-xs shadow-[var(--theme-shadow)] pointer-events-none"
        >
          {toastMessage}
        </div>
      )}

      {/* 设置菜单与偏好弹窗 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onCancel={handleCancelSettings}
        onSave={handleSaveSettings}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onOpenDisclaimer={ai.openDisclaimer}
      />

      {/* AI 安全与免责声明弹窗 */}
      <DisclaimerModal
        isOpen={ai.isDisclaimerOpen}
        onAccept={ai.handleAcceptDisclaimer}
        onClose={ai.closeDisclaimer}
      />
    </div>
  );
}
