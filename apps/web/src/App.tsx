import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentState,
} from "@md-editor/editor-core";
import {
  EditorUiProvider,
  AssetPreview,
  useEditorUiState,
  useEditorUiActions,
  type CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import { useTranslation, changeLanguage } from "@md-editor/i18n";
import type { MarkdownFileTreeNode, MarkdownFolder } from "@md-editor/file-system";
import { WebHeader } from "./components/WebHeader";
import { WebEditor } from "./components/WebEditor";
import { WebSidebar } from "./components/WebSidebar";
import { SidebarResizer, SIDEBAR_DEFAULT_WIDTH } from "./components/SidebarResizer";
import { CollapsedSidebarReveal } from "./components/CollapsedSidebarReveal";
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
import { webFileSystem } from "./lib/web-file-system";
import { useImagePaste } from "./lib/use-image-paste";

export function App() {
  const [settings, setSettings] = useState<WebSettings>(() => loadWebSettings());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 初始化 DocumentState
  const initialMarkdown = useMemo(() => {
    return loadSavedDraft() || DEFAULT_SHOWCASE_MARKDOWN;
  }, []);

  const [documentState] = useState<DocumentState>(() =>
    createDocumentState({ markdown: initialMarkdown }),
  );

  const [currentMarkdown, setCurrentMarkdown] = useState(initialMarkdown);

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

  // 监听多语言设置
  useEffect(() => {
    changeLanguage(settings.language);
  }, [settings.language]);

  // 复用桌面端真实主题 CSS 变量与色彩模式
  useEffect(() => {
    return applyDesktopTheme(settings);
  }, [settings]);

  return (
    <EditorUiProvider markdown={currentMarkdown} showToast={showToast}>
      <MainWebEditorApp
        settings={settings}
        setSettings={setSettings}
        documentState={documentState}
        currentMarkdown={currentMarkdown}
        setCurrentMarkdown={setCurrentMarkdown}
        toastMessage={toastMessage}
        showToast={showToast}
      />
    </EditorUiProvider>
  );
}

interface MainWebEditorAppProps {
  settings: WebSettings;
  setSettings: React.Dispatch<React.SetStateAction<WebSettings>>;
  documentState: DocumentState;
  currentMarkdown: string;
  setCurrentMarkdown: (val: string) => void;
  toastMessage: string | null;
  showToast: (msg: string | null) => void;
}

function findFirstMd(node: MarkdownFileTreeNode): string | null {
  if (node.kind === "markdown") return node.path;
  for (const child of node.children || []) {
    const found = findFirstMd(child);
    if (found) return found;
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function MainWebEditorApp({
  settings,
  setSettings,
  documentState,
  currentMarkdown,
  setCurrentMarkdown,
  toastMessage,
  showToast,
}: MainWebEditorAppProps) {
  const { t } = useTranslation();
  const { outline, activeOutlineId } = useEditorUiState();
  const { jumpToTocItem } = useEditorUiActions();

  const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [ports, setPorts] = useState<CodeMirrorEditorPorts | null>(null);

  // 文件系统与工作区状态
  const [folder, setFolder] = useState<MarkdownFolder | null>(() =>
    webFileSystem.getOpenedFolder(),
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [openedAsset, setOpenedAsset] = useState<{ name: string; url: string } | null>(null);

  // 侧栏状态
  const [isSidebarVisible, setIsSidebarVisible] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 960 : true,
  );
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);

  // 监听文档状态变更
  useEffect(() => {
    const unsubscribe = documentState.subscribeTransitions((event) => {
      const snap = documentState.getSnapshot();
      setCurrentMarkdown(snap.markdown);
      setMode(snap.mode);
      setIsDirty(snap.isDirty);
      if (event.transition.kind === "content") {
        if (!activeFilePath) {
          saveDraft(snap.markdown);
        }
      }
    });
    return () => unsubscribe();
  }, [documentState, activeFilePath, setCurrentMarkdown]);

  // 监听异步资源图片缓存就绪事件，触发视图与测量刷新
  const [, setAssetRevision] = useState(0);
  useEffect(() => {
    return webFileSystem.onAssetCacheChange(() => {
      setAssetRevision((v) => v + 1);
      ports?.requestMeasure();
    });
  }, [ports]);

  // 监听工作区目录文件树变更（粘贴图片、落盘、新建、删除等触发的重新扫描）
  useEffect(() => {
    return webFileSystem.onFolderChange((nextFolder) => {
      setFolder(nextFolder);
    });
  }, []);

  // 图片复制粘贴与拖拽落盘系统
  useImagePaste({
    ports,
    currentMarkdown,
    onUpdateMarkdown: (nextMarkdown) => {
      documentState.replaceDocument(
        {
          markdown: nextMarkdown,
          savedMarkdown: documentState.getSnapshot().savedMarkdown,
          filePath: activeFilePath,
        },
        { kind: "command", commandId: "image.paste" },
      );
    },
    showToast,
  });

  // 编辑器模式切换
  const handleChangeMode = useCallback(
    (newMode: "wysiwyg" | "source") => {
      if (ports) {
        ports.flushPendingEdits?.();
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

  // 在 MainWebEditorApp 内部：
  // 打开本地文件夹
  const handleOpenFolder = useCallback(async () => {
    try {
      showToast("正在打开本地文件夹...");
      const opened = await webFileSystem.openDirectory();
      if (!opened) return;
      setFolder(opened);
      setIsSidebarVisible(true);
      showToast(`已加载工作区目录: ${opened.rootName}`);

      const firstMd = findFirstMd(opened.tree);
      if (firstMd) {
        const text = await webFileSystem.readFile(firstMd);
        documentState.replaceDocument(
          { markdown: text, savedMarkdown: text, filePath: firstMd },
          { kind: "command", commandId: "file.openFirst" },
        );
        setActiveFilePath(firstMd);
        setOpenedAsset(null);
      }
    } catch (err: unknown) {
      console.error(err);
      showToast(getErrorMessage(err) || "打开文件夹失败");
    }
  }, [documentState, showToast]);

  // 刷新当前文件夹
  const handleRefreshFolder = useCallback(async () => {
    try {
      const refreshed = await webFileSystem.refreshDirectory();
      if (refreshed) {
        setFolder(refreshed);
        showToast("已刷新文件树");
      }
    } catch (err: unknown) {
      showToast(getErrorMessage(err) || "刷新文件树失败");
    }
  }, [showToast]);

  // 打开单个 Markdown 文件
  const handleOpenSingleFile = useCallback(async () => {
    try {
      const res = await webFileSystem.openSingleFile();
      if (!res) return;
      documentState.replaceDocument(
        { markdown: res.content, savedMarkdown: res.content, filePath: res.name },
        { kind: "command", commandId: "file.openSingle" },
      );
      setActiveFilePath(res.name);
      setOpenedAsset(null);
      showToast(`已打开文档: ${res.name}`);
    } catch (err: unknown) {
      showToast(getErrorMessage(err) || "打开文件失败");
    }
  }, [documentState, showToast]);

  // 在工作区树中点击打开文件
  const handleOpenFile = useCallback(
    async (path: string) => {
      try {
        const text = await webFileSystem.readFile(path);
        documentState.replaceDocument(
          { markdown: text, savedMarkdown: text, filePath: path },
          { kind: "command", commandId: "file.openTreeItem" },
        );
        setActiveFilePath(path);
        setOpenedAsset(null);
      } catch (err: unknown) {
        showToast(getErrorMessage(err) || "读取文件失败");
      }
    },
    [documentState, showToast],
  );

  // 点击打开图片资源预览
  const handleOpenAsset = useCallback(
    async (path: string) => {
      const fileName = path.split("/").pop() || "Image";
      showToast(`正在预览图片: ${fileName}`);
      const assetUrl = await webFileSystem.getAssetUrl(path);
      setOpenedAsset({
        name: fileName,
        url: assetUrl ?? path,
      });
    },
    [showToast],
  );

  // 新建草稿文档
  const handleNewDraft = useCallback(() => {
    clearSavedDraft();
    documentState.replaceDocument(
      {
        markdown: "# Untitled\n\n",
        savedMarkdown: "# Untitled\n\n",
        filePath: null,
      },
      { kind: "command", commandId: "file.newDraft" },
    );
    setActiveFilePath(null);
    setOpenedAsset(null);
    showToast("已新建草稿文档");
  }, [documentState, showToast]);

  // 保存文档（有本地文件则原子写盘，无则保存至草稿）
  const handleSave = useCallback(async () => {
    if (activeFilePath && webFileSystem.hasOpenedFolder()) {
      try {
        const checkpoint = documentState.beginSave({
          kind: "current-path",
          path: activeFilePath,
        });
        await webFileSystem.writeFile(activeFilePath, currentMarkdown);
        documentState.settleSave(checkpoint, {
          status: "succeeded",
          commit: "committed",
          filePath: activeFilePath,
          warnings: [],
        });
        showToast("已成功保存并落盘至本地文件");
      } catch (err: unknown) {
        console.error(err);
        showToast(`保存文件失败: ${getErrorMessage(err)}`);
      }
    } else {
      saveDraft(currentMarkdown);
      showToast(t("toasts.docSavedToStorage"));
    }
  }, [activeFilePath, currentMarkdown, documentState, showToast, t]);

  // 新建文件或文件夹
  const handleCreateItem = useCallback(
    async (parentPath: string, name: string, kind: "markdown" | "directory") => {
      try {
        const newPath = await webFileSystem.createItem(parentPath, name, kind);
        setFolder(webFileSystem.getOpenedFolder());
        if (kind === "markdown") {
          await handleOpenFile(newPath);
        }
        showToast(`已成功创建 ${kind === "directory" ? "文件夹" : "文件"}: ${name}`);
      } catch (err: unknown) {
        showToast(`创建失败: ${getErrorMessage(err)}`);
      }
    },
    [handleOpenFile, showToast],
  );

  // 重命名文件或目录
  const handleRenameItem = useCallback(
    async (node: MarkdownFileTreeNode, newName: string) => {
      try {
        const newPath = await webFileSystem.renameItem(node.path, newName);
        setFolder(webFileSystem.getOpenedFolder());
        if (activeFilePath === node.path) {
          setActiveFilePath(newPath);
        }
        showToast(`已重命名为: ${newName}`);
      } catch (err: unknown) {
        showToast(`重命名失败: ${getErrorMessage(err)}`);
      }
    },
    [activeFilePath, showToast],
  );

  // 删除文件或目录
  const handleDeleteItem = useCallback(
    async (node: MarkdownFileTreeNode) => {
      try {
        await webFileSystem.deleteItem(node.path);
        setFolder(webFileSystem.getOpenedFolder());
        if (activeFilePath === node.path) {
          handleNewDraft();
        }
        showToast(`已删除: ${node.name}`);
      } catch (err: unknown) {
        showToast(`删除失败: ${getErrorMessage(err)}`);
      }
    },
    [activeFilePath, handleNewDraft, showToast],
  );

  // 导出 Markdown 文件
  const handleExport = useCallback(() => {
    const filename = activeFilePath ? activeFilePath.split("/").pop()! : "inkpoint-document.md";
    exportMarkdown(currentMarkdown, filename);
    showToast(t("toasts.exportedDoc", { filename }));
  }, [activeFilePath, currentMarkdown, showToast, t]);

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

  // 重置为默认展示文档
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
    setActiveFilePath(null);
    setOpenedAsset(null);
    showToast(t("toasts.demoReset"));
  };

  // 触发 AI 智能续写
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
      ports.showSuggestion({
        items: [{ from: cursorPos, to: cursorPos, text: continuation }],
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

  // 绑定全局键盘快捷键
  useEffect(() => {
    return bindWebKeyboardShortcuts({
      onToggleMode: () => {
        handleChangeMode(mode === "wysiwyg" ? "source" : "wysiwyg");
      },
      onToggleSidebar: () => {
        setIsSidebarVisible((prev) => !prev);
      },
      onToggleOutline: () => {
        setIsSidebarVisible(true);
      },
      onOpenSettings: () => {
        setIsSettingsOpen(true);
      },
      onSave: () => {
        void handleSave();
      },
      onExport: handleExport,
      onNewDocument: handleNewDraft,
      onOpenDocument: () => {
        void handleOpenSingleFile();
      },
      onOpenFolder: () => {
        void handleOpenFolder();
      },
      onTriggerAi: () => {
        void handleTriggerAiRef.current();
      },
      onCloseOverlay: () => {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else {
          ports?.dismissSuggestion();
        }
      },
    });
  }, [
    mode,
    isSettingsOpen,
    ports,
    handleSave,
    handleExport,
    handleNewDraft,
    handleOpenSingleFile,
    handleOpenFolder,
    handleChangeMode,
  ]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--theme-bg)] text-[var(--theme-text)]">
      {/* 顶部导航栏 */}
      <WebHeader
        theme={settings.theme}
        isSidebarVisible={isSidebarVisible}
        activeFilePath={activeFilePath}
        isDirty={isDirty}
        mode={mode}
        isCopied={isCopied}
        onToggleSidebar={() => setIsSidebarVisible((prev) => !prev)}
        onToggleMode={handleChangeMode}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onTriggerAi={() => void handleTriggerAi()}
        onCopy={handleCopy}
        onExport={handleExport}
      />

      {/* 主工作区（左侧栏 + 拖拽调宽 + 编辑器） */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧可折叠侧边栏 */}
        <WebSidebar
          isVisible={isSidebarVisible}
          sidebarWidth={sidebarWidth}
          folder={folder}
          activeFilePath={activeFilePath}
          mode={mode}
          outline={outline}
          activeOutlineId={activeOutlineId}
          onSelectOutlineItem={jumpToTocItem}
          onChangeMode={handleChangeMode}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onCloseSidebar={() => setIsSidebarVisible(false)}
          onOpenFile={(path) => void handleOpenFile(path)}
          onOpenAsset={(path) => void handleOpenAsset(path)}
          onOpenFolder={() => void handleOpenFolder()}
          onOpenSingleFile={() => void handleOpenSingleFile()}
          onNewDraft={handleNewDraft}
          onRefreshFolder={() => void handleRefreshFolder()}
          onCreateItem={handleCreateItem}
          onRenameItem={handleRenameItem}
          onDeleteItem={handleDeleteItem}
        />

        {/* 侧栏调宽手柄 */}
        {isSidebarVisible ? (
          <SidebarResizer
            width={sidebarWidth}
            onCommitWidth={setSidebarWidth}
            onCollapse={() => setIsSidebarVisible(false)}
          />
        ) : null}

        {/* 编辑区 */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-surface)]">
          {/* 侧栏收起悬浮唤起手柄 */}
          {!isSidebarVisible && (
            <CollapsedSidebarReveal onReveal={() => setIsSidebarVisible(true)} />
          )}

          {/* 图片资源预览 或 CodeMirror 编辑器 */}
          {openedAsset ? (
            <div className="absolute inset-0 z-10 flex min-h-0 flex-col">
              <AssetPreview
                asset={{ name: openedAsset.name, path: openedAsset.url }}
                resolveAssetSrc={(p) => webFileSystem.resolveImageSrc(p, null)}
                onBack={() => setOpenedAsset(null)}
              />
            </div>
          ) : (
            <WebEditor
              document={documentState}
              settings={settings}
              activeFilePath={activeFilePath}
              onRendererPortsChange={setPorts}
            />
          )}
        </main>
      </div>

      {/* 浮动胶囊 Toast 提示 */}
      {toastMessage && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-xs font-medium text-[var(--theme-title)] shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      )}

      {/* 设置面板 */}
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
  );
}
