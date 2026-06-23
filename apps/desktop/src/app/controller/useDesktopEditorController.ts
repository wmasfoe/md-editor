import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { switchEditorModeSafely, type EditorMode, createRecentFilesStore } from "@md-editor/editor-core";
import type { ConfirmationChoice, ConfirmationState, TocTarget } from "@md-editor/editor-ui";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  FileTreeMutationResult,
  MarkdownDocumentFile,
  MarkdownFileTreeNode,
  MarkdownFolder
} from "@md-editor/file-system";
import { extractHeadingOutline, findActiveHeadingIdForLine } from "@md-editor/markdown-fidelity";
import { fileService } from "../../desktop/file-service";
import { dirname, isSameOrChildPath } from "../../lib/path";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import type { OpenedAsset, SidebarMode, TreeItemKind } from "../../types";
import {
  bindDesktopMenuCommands,
  bindRuntimeKeyboardShortcuts
} from "../events/command-bindings";
import { bindDropImageListener } from "../events/drop-image-listener";
import { bindRecentFileMenuEvents } from "../events/recent-file-events";
import { bindPasteImageListener } from "../events/paste-image-listener";
import { bindBrowserDirtyDocumentGuard, bindTauriCloseGuard } from "../events/window-guards";
import { findFirstMarkdownPath, resolveOpenDocumentMutation } from "../files/file-tree-mutations";
import { runtime } from "../runtime/editor-runtime";
import {
  appVersion,
  checkForUpdates,
  createDefaultSettings,
  keyboardShortcutLabel,
  loadAppSettings,
  normalizeShortcutKey,
  saveAppSettings,
  validateAssetsDirectory,
  type AppSettings,
  type UpdateStatus
} from "../settings/app-settings";
import { shouldRefreshFolderAfterSave } from "./save-folder-refresh";

const recentFilesStore = createRecentFilesStore();

interface ToastState {
  readonly id: number;
  readonly message: string;
}

export function useDesktopEditorController() {
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tocTarget, setTocTarget] = useState<TocTarget | null>(null);
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => window.innerWidth >= 960);
  const [hasActiveDocument, setHasActiveDocument] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [openedAsset, setOpenedAsset] = useState<OpenedAsset | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [shortcutDrafts, setShortcutDrafts] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      createDefaultSettings().shortcuts.map((shortcut) => [shortcut.id, keyboardShortcutLabel(shortcut.key)])
    )
  );
  const [assetsDirectoryDraft, setAssetsDirectoryDraft] = useState(createDefaultSettings().assetsDirectory);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() => ({
    currentVersion: appVersion(),
    state: "idle",
    message: "点击检查更新获取当前发布状态。"
  }));
  const confirmationResolver = useRef<((choice: ConfirmationChoice) => void) | null>(null);
  const documentKey = `${snapshot.filePath ?? "untitled"}:${editorRevision}`;
  const deferredMarkdown = useDeferredValue(snapshot.markdown);
  const outline = useMemo(() => extractHeadingOutline(deferredMarkdown), [deferredMarkdown]);

  const showToast = useCallback((message: string | null) => {
    if (!message) {
      setToast(null);
      return;
    }

    setToast({
      id: Date.now(),
      message
    });
  }, []);

  const commitMarkdown = useCallback((markdown: string) => {
    setHasActiveDocument(true);
    showToast(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
  }, [showToast]);

  const applyProgrammaticMarkdown = useCallback((markdown: string) => {
    showToast(null);
    setOpenedAsset(null);
    setSnapshot(runtime.document.updateMarkdown(markdown));
    setEditorRevision((current) => current + 1);
  }, [showToast]);

  const syncSettingsDrafts = useCallback((nextSettings: AppSettings) => {
    setShortcutDrafts(
      Object.fromEntries(
        nextSettings.shortcuts.map((shortcut) => [shortcut.id, keyboardShortcutLabel(shortcut.key)])
      )
    );
    setAssetsDirectoryDraft(nextSettings.assetsDirectory);
  }, []);

  const openSettings = useCallback(() => {
    syncSettingsDrafts(settings);
    setSettingsErrorMessage(null);
    setIsSettingsOpen(true);
  }, [settings, syncSettingsDrafts]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    setSettingsErrorMessage(null);
    syncSettingsDrafts(settings);
  }, [settings, syncSettingsDrafts]);

  const captureShortcutDraft = useCallback((id: string, key: string) => {
    setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(key) }));
  }, []);

  const resetShortcutDraft = useCallback(
    (id: string) => {
      const shortcut = settings.shortcuts.find((candidate) => candidate.id === id);
      if (!shortcut) {
        return;
      }
      setShortcutDrafts((current) => ({ ...current, [id]: keyboardShortcutLabel(shortcut.defaultKey) }));
    },
    [settings.shortcuts]
  );

  const saveSettings = useCallback(async () => {
    const nextAssetsDirectory = validateAssetsDirectory(assetsDirectoryDraft);
    if (!nextAssetsDirectory) {
      setSettingsErrorMessage("图片资源目录必须是当前文档目录内的子目录，例如 assets 或 images/posts。");
      return;
    }

    // 快捷键保存前统一校验，避免两个命令在全局 keydown 捕获阶段抢同一个组合。
    const normalizedShortcuts = [];
    for (const shortcut of settings.shortcuts) {
      const key = normalizeShortcutKey(shortcutDrafts[shortcut.id] ?? shortcut.key);
      if (!key) {
        setSettingsErrorMessage(`“${shortcut.label}”快捷键格式无效，请使用 Command+Shift+B 这类组合。`);
        return;
      }
      normalizedShortcuts.push({ ...shortcut, key });
    }
    const duplicate = findDuplicateShortcut(normalizedShortcuts.map((shortcut) => shortcut.key));
    if (duplicate) {
      setSettingsErrorMessage(`快捷键 ${keyboardShortcutLabel(duplicate)} 被重复使用。`);
      return;
    }

    setIsSavingSettings(true);
    setSettingsErrorMessage(null);
    try {
      const saved = await saveAppSettings({
        shortcuts: normalizedShortcuts,
        assetsDirectory: nextAssetsDirectory
      });
      setSettings(saved);
      syncSettingsDrafts(saved);
      setIsSettingsOpen(false);
    } catch (error) {
      setSettingsErrorMessage(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setIsSavingSettings(false);
    }
  }, [assetsDirectoryDraft, settings.shortcuts, shortcutDrafts, syncSettingsDrafts]);

  const runUpdateCheck = useCallback(async () => {
    // 现在没有接入 Tauri updater，检查动作仍保留入口和状态，后续可直接替换实现。
    setUpdateStatus({
      currentVersion: appVersion(),
      state: "checking",
      message: "正在检查更新..."
    });
    setUpdateStatus(await checkForUpdates(appVersion()));
  }, []);

  const switchMode = useCallback(async (mode: EditorMode) => {
    const result = await switchEditorModeSafely(runtime.document, mode);
    setSnapshot(result.snapshot);
    showToast(result.ok ? null : result.message);
  }, [showToast]);

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  const replaceDocument = useCallback((document: MarkdownDocumentFile | null) => {
    if (!document) {
      return;
    }

    runtime.document.updateMarkdown(document.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: document.markdown,
        filePath: document.filePath
      })
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);

    // 添加到最近文件列表
    const fileName = document.filePath.split("/").pop() || "Untitled";
    void recentFilesStore.add({
      path: document.filePath,
      name: fileName
    }).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "最近文件保存失败。");
    });
  }, [showToast]);

  const markCurrentDocumentSaved = useCallback((document: MarkdownDocumentFile) => {
    setSnapshot(
      runtime.document.markSaved({
        markdown: document.markdown,
        filePath: document.filePath
      })
    );
    showToast(null);
    setOpenedAsset(null);

    const fileName = document.filePath.split("/").pop() || "Untitled";
    void recentFilesStore.add({
      path: document.filePath,
      name: fileName
    }).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "最近文件保存失败。");
    });
  }, [showToast]);

  const refreshFolderForDocumentPath = useCallback(
    async (documentPath: string) => {
      const nextRootPath =
        folder && isSameOrChildPath(documentPath, folder.rootPath)
          ? folder.rootPath
          : dirname(documentPath);

      setFolder(await fileService.refreshFolder(nextRootPath));
      setSidebarMode("files");
    },
    [folder]
  );

  const runFileAction = useCallback(async (label: string, action: () => Promise<void> | void) => {
    setPendingAction(label);
    showToast(null);
    try {
      await action();
    } catch (error) {
      showToast(formatActionError(error, "文件操作失败。"));
    } finally {
      setPendingAction(null);
    }
  }, [showToast]);

  const requestConfirmation = useCallback((nextConfirmation: ConfirmationState) => {
    return new Promise<ConfirmationChoice>((resolve) => {
      confirmationResolver.current = resolve;
      setConfirmation(nextConfirmation);
    });
  }, []);

  const resolveConfirmation = useCallback((choice: ConfirmationChoice) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(choice);
  }, []);

  const saveDocument = useCallback(
    async (forceDialog = false) => {
      await runFileAction(forceDialog ? "正在另存为" : "正在保存", async () => {
        const current = runtime.document.getSnapshot();
        const saved = forceDialog
          ? await fileService.saveDocumentAs({
              filePath: current.filePath,
              markdown: current.markdown
            })
          : await fileService.saveDocument({
              filePath: current.filePath,
              markdown: current.markdown
            });

        if (saved) {
          // 只有原生保存确认成功后才清除 dirty；取消弹窗或写入失败都保持未保存状态。
          markCurrentDocumentSaved(saved);
          if (
            shouldRefreshFolderAfterSave({
              previousPath: current.filePath,
              savedPath: saved.filePath,
              openedRootPath: folder?.rootPath ?? null
            })
          ) {
            await refreshFolderForDocumentPath(saved.filePath);
          }
        }
      });
    },
    [folder?.rootPath, markCurrentDocumentSaved, refreshFolderForDocumentPath, runFileAction]
  );

  const ensureDiscardAllowed = useCallback(async (description?: string) => {
    if (!runtime.document.getSnapshot().isDirty) {
      return true;
    }

    const choice = await requestConfirmation({
      title: "保存当前文档的更改？",
      description:
        description ?? "继续后将切换到其他文档。你可以先保存，或放弃尚未保存的更改。",
      confirmLabel: "保存并继续",
      secondaryLabel: "不保存"
    });

    if (choice === "secondary") {
      return true;
    }
    if (choice !== "confirm") {
      return false;
    }

    await saveDocument(false);
    return !runtime.document.getSnapshot().isDirty;
  }, [requestConfirmation, saveDocument]);

  const createNewDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    const nextDocument = fileService.newDocument("");
    runtime.document.updateMarkdown(nextDocument.markdown);
    setSnapshot(
      runtime.document.markSaved({
        markdown: nextDocument.markdown,
        filePath: nextDocument.filePath
      })
    );
    showToast(null);
    setOpenedAsset(null);
    setHasActiveDocument(true);
  }, [ensureDiscardAllowed, showToast]);

  const openDocument = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开", async () => {
      const document = await fileService.openDocument();
      replaceDocument(document);
      if (document) {
        await refreshFolderForDocumentPath(document.filePath);
      }
    });
  }, [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]);

  const openRecentFile = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        try {
          const document = await fileService.openDocumentAtPath(filePath);
          replaceDocument(document);
          await refreshFolderForDocumentPath(document.filePath);
        } catch (error) {
          // 文件可能已被删除或移动，从最近列表中移除
          await recentFilesStore.remove(filePath);
          throw error;
        }
      });
    },
    [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]
  );

  const openRecentDocument = useCallback(async () => {
    const recentFiles = recentFilesStore.list();

    if (recentFiles.length === 0) {
      showToast("没有最近打开的文件");
      return;
    }
    showToast("请从“最近文件”菜单中选择要打开的文件。");
  }, [showToast]);

  const openFolder = useCallback(async () => {
    if (!(await ensureDiscardAllowed())) {
      return;
    }

    await runFileAction("正在打开文件夹", async () => {
      const openedFolder = await fileService.openFolder();
      if (!openedFolder) {
        return;
      }
      const firstMarkdownPath = findFirstMarkdownPath(openedFolder.tree);
      const firstDocument = firstMarkdownPath
        ? await fileService.openDocumentAtPath(firstMarkdownPath)
        : null;
      setFolder(openedFolder);
      setSidebarMode("files");
      setIsSidebarVisible(true);
      replaceDocument(firstDocument);
    });
  }, [ensureDiscardAllowed, replaceDocument, runFileAction]);

  const refreshOpenedFolder = useCallback(
    async (documentPath?: string) => {
      const currentPath = documentPath ?? runtime.document.getSnapshot().filePath;
      if (!currentPath) {
        return;
      }

      await refreshFolderForDocumentPath(currentPath);
    },
    [refreshFolderForDocumentPath]
  );

  const openDocumentFromTree = useCallback(
    async (filePath: string) => {
      if (!(await ensureDiscardAllowed())) {
        return;
      }

      await runFileAction("正在打开", async () => {
        const document = await fileService.openDocumentAtPath(filePath);
        replaceDocument(document);
        await refreshFolderForDocumentPath(document.filePath);
      });
    },
    [ensureDiscardAllowed, refreshFolderForDocumentPath, replaceDocument, runFileAction]
  );

  const openAssetFromTree = useCallback((node: MarkdownFileTreeNode) => {
    showToast(null);
    setOpenedAsset({ name: node.name, path: node.path });
  }, [showToast]);

  const closeAssetPreview = useCallback(() => {
    setOpenedAsset(null);
  }, []);

  const applyFileTreeMutation = useCallback(
    (result: FileTreeMutationResult, previousPath?: string) => {
      setFolder(result.folder);

      const current = runtime.document.getSnapshot();
      const mutation = resolveOpenDocumentMutation(current.filePath, result, previousPath);
      if (mutation.kind === "move") {
        setSnapshot(
          runtime.document.markSaved({
            markdown: current.markdown,
            filePath: mutation.filePath
          })
        );
        return;
      }

      if (mutation.kind === "none") {
        return;
      }

      const markdown = "";
      runtime.document.updateMarkdown(markdown);
      setSnapshot(runtime.document.markSaved({ markdown, filePath: null }));
    },
    []
  );

  const createTreeItem = useCallback(
    async (parentPath: string, kind: TreeItemKind, name: string) => {
      if (!folder) {
        return;
      }

      await runFileAction(kind === "markdown" ? "正在新建文件" : "正在新建文件夹", async () => {
        const result = await fileService.createTreeItem({
          rootPath: folder.rootPath,
          parentPath,
          name,
          kind
        });
        applyFileTreeMutation(result);
      });
    },
    [applyFileTreeMutation, folder, runFileAction]
  );

  const renameTreeItem = useCallback(
    async (node: MarkdownFileTreeNode, name: string) => {
      if (!folder || name === node.name) {
        return;
      }

      await runFileAction("正在重命名", async () => {
        const result = await fileService.renameTreeItem({
          rootPath: folder.rootPath,
          path: node.path,
          name
        });
        applyFileTreeMutation(result, node.path);
        if (result.affectedPath) {
          await recentFilesStore.move(node.path, {
            path: result.affectedPath,
            name: result.affectedPath.split("/").pop() || name
          });
        }
      });
    },
    [applyFileTreeMutation, folder, runFileAction]
  );

  const deleteTreeItem = useCallback(
    async (node: MarkdownFileTreeNode) => {
      if (!folder) {
        return;
      }

      const choice = await requestConfirmation({
        title: `删除“${node.name}”？`,
        description: node.kind === "directory" ? "该文件夹及其中的内容将被永久删除。" : "该文件将被永久删除。",
        confirmLabel: "删除",
        destructive: true
      });
      if (choice !== "confirm") {
        return;
      }

      await runFileAction("正在删除", async () => {
        const result = await fileService.deleteTreeItem({
          rootPath: folder.rootPath,
          path: node.path
        });
        applyFileTreeMutation(result, node.path);
      });
    },
    [applyFileTreeMutation, folder, requestConfirmation, runFileAction]
  );

  useEffect(
    () =>
      bindPasteImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder,
        assetsDirectory: settings.assetsDirectory
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction, settings.assetsDirectory]
  );
  useEffect(
    () =>
      bindDropImageListener({
        replaceDocument,
        runFileAction,
        applyMarkdown: applyProgrammaticMarkdown,
        afterSaveImage: refreshOpenedFolder,
        assetsDirectory: settings.assetsDirectory
      }),
    [applyProgrammaticMarkdown, refreshOpenedFolder, replaceDocument, runFileAction, settings.assetsDirectory]
  );

  const jumpToTocItem = useCallback((target: Omit<TocTarget, "nonce">) => {
    const matched = outline.find(
      (item) => item.line === target.line && item.level === target.level && item.text === target.text
    );
    setActiveOutlineId(matched?.id ?? null);
    setTocTarget({ ...target, nonce: Date.now() });
  }, [outline]);

  const updateActiveOutlineForLine = useCallback(
    (line: number) => {
      setActiveOutlineId(findActiveHeadingIdForLine(outline, line));
    },
    [outline]
  );

  useEffect(() => {
    // 编辑可能删除或重命名当前标题，及时清掉过期 id，避免大纲高亮不存在的章节。
    if (activeOutlineId && !outline.some((item) => item.id === activeOutlineId)) {
      setActiveOutlineId(null);
    }
  }, [activeOutlineId, outline]);

  const resolveImageSrc = useCallback(
    (src: string) => resolvePreviewImageSrc(snapshot.filePath, src),
    [snapshot.filePath]
  );

  const toggleSidebarPrimary = useCallback(async () => {
    setIsSidebarVisible((current) => !current);
  }, []);

  const getRecentFiles = useCallback(() => {
    return recentFilesStore.list();
  }, []);

  const dispatchCommand = useCallback(
    async (id: string) => {
      // 全局菜单和快捷键在 React 外部捕获；有弹窗等待决策时先忽略，避免 Promise 丢失。
      if (confirmationResolver.current) {
        return;
      }
      await runtime.commands.dispatch(id, {
        document: runtime.document,
        actions: {
          newDocument: createNewDocument,
          openDocument,
          openRecentDocument,
          openFolder,
          saveDocument: () => saveDocument(false),
          saveDocumentAs: () => saveDocument(true),
          openSettings,
          toggleSourceMode,
          showWysiwygMode: () => switchMode("wysiwyg"),
          toggleSidebarPrimary
        }
      });
    },
    [
      createNewDocument,
      openDocument,
      openRecentDocument,
      openFolder,
      openSettings,
      saveDocument,
      switchMode,
      toggleSidebarPrimary,
      toggleSourceMode
    ]
  );

  useEffect(() => {
    return bindRuntimeKeyboardShortcuts(dispatchCommand, settings);
  }, [dispatchCommand, settings]);
  useEffect(() => {
    return bindDesktopMenuCommands(dispatchCommand);
  }, [dispatchCommand]);
  useEffect(() => bindBrowserDirtyDocumentGuard(), []);
  useEffect(
    () =>
      bindTauriCloseGuard(() =>
        ensureDiscardAllowed("关闭应用前，你可以保存当前文档，或放弃尚未保存的更改。")
      ),
    [ensureDiscardAllowed]
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const collapseForNarrowWindow = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setIsSidebarVisible(false);
      }
    };
    media.addEventListener("change", collapseForNarrowWindow);
    return () => media.removeEventListener("change", collapseForNarrowWindow);
  }, []);

  useEffect(() => {
    const fileName = snapshot.filePath?.split(/[\\/]/).pop() || "未命名文档";
    const title = `${fileName}${snapshot.isDirty ? "*" : ""}`;
    document.title = title;
    if (isTauri()) {
      // Web 预览没有原生窗口；标题同步失败不能影响任一运行时的编辑流程。
      void getCurrentWindow().setTitle(title).catch((error: unknown) => {
        console.warn("窗口标题同步失败", error);
      });
    }
  }, [snapshot.filePath, snapshot.isDirty]);

  useEffect(
    () =>
      bindRecentFileMenuEvents({
        store: recentFilesStore,
        openRecentFile,
        onError: showToast
      }),
    [openRecentFile, showToast]
  );

  useEffect(() => {
    // 设置异步加载；先用默认值渲染，加载成功后再重绑快捷键和图片目录。
    let cancelled = false;

    void loadAppSettings()
      .then((loadedSettings) => {
        if (cancelled) {
          return;
        }
        setSettings(loadedSettings);
        syncSettingsDrafts(loadedSettings);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "设置读取失败。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast, syncSettingsDrafts]);

  return {
    snapshot,
    toast,
    pendingAction,
    tocTarget,
    folder,
    sidebarMode,
    isSidebarVisible,
    hasActiveDocument,
    openedAsset,
    documentKey,
    outline,
    activeOutlineId,
    confirmation,
    settings,
    isSettingsOpen,
    shortcutDrafts,
    assetsDirectoryDraft,
    settingsErrorMessage,
    isSavingSettings,
    updateStatus,
    setSidebarMode,
    setIsSidebarVisible,
    setAssetsDirectoryDraft,
    commitMarkdown,
    dispatchCommand,
    openDocumentFromTree,
    openAssetFromTree,
    closeAssetPreview,
    createTreeItem,
    renameTreeItem,
    deleteTreeItem,
    jumpToTocItem,
    setActiveOutlineId,
    resolveConfirmation,
    updateActiveOutlineForLine,
    resolveImageSrc,
    getRecentFiles,
    openRecentFile,
    closeSettings,
    captureShortcutDraft,
    resetShortcutDraft,
    saveSettings,
    runUpdateCheck
  };
}

function findDuplicateShortcut(shortcuts: readonly string[]): string | null {
  const seen = new Set<string>();

  for (const shortcut of shortcuts) {
    if (seen.has(shortcut)) {
      return shortcut;
    }
    seen.add(shortcut);
  }

  return null;
}

function formatActionError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}
