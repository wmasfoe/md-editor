// apps/utools/src/components/UtoolsApp.tsx
// uTools 插件主应用容器
// 100% 收敛在 apps/utools，复用 @md-editor/editor-core 与 @md-editor/editor-ui 核心

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createDocumentState,
  switchEditorModeSafely,
  type DocumentState,
} from "@md-editor/editor-core";
import {
  CodeMirrorEditor,
  EditorUiProvider,
  type CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import {
  appendImageMarkdown,
  imageAltTextFromFileName,
  type MarkdownFileTreeNode,
  type MarkdownFolder,
} from "@md-editor/file-system";
import {
  clearLastOpenedFile,
  clearLastOpenedFolder,
  loadLastOpenedFile,
  loadLastOpenedFolder,
  loadUtoolsSettings,
  saveLastOpenedFile,
  saveLastOpenedFolder,
  saveUtoolsSettings,
  type UtoolsSettings,
} from "../utools/db-storage";
import { resolveCodeFontStack, resolveProseFontStack } from "../utools/fonts";
import { registerUtoolsLifecycle, type PluginEnterDetail } from "../utools/lifecycle";
import { applyResolvedUtoolsTheme, resolveUtoolsTheme } from "../utools/theme";
import type { EditorMode } from "../utools/types";
import { ReferralBanner } from "./ReferralBanner";
import { DisclaimerModal } from "./DisclaimerModal";
import { SettingsModal } from "./SettingsModal";
import { UtoolsFileTree } from "./UtoolsFileTree";
import { UtoolsStatusBar } from "./UtoolsStatusBar";
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

function findFirstMarkdown(node: MarkdownFileTreeNode): MarkdownFileTreeNode | null {
  if (node.kind === "markdown") return node;
  if (node.kind === "directory" && node.children) {
    const readme = node.children.find((c) => c.kind === "markdown" && /^readme\.md$/i.test(c.name));
    if (readme) return readme;
    for (const child of node.children) {
      const found = findFirstMarkdown(child);
      if (found) return found;
    }
  }
  return null;
}

export function UtoolsApp() {
  const [mode, setMode] = useState<EditorMode>("file");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UtoolsSettings>(() => loadUtoolsSettings());
  const [folder, setFolder] = useState<MarkdownFolder | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 初始化持久化文档模型：优先读取上次打开的本地文件，若无则初始化空白文档
  const initialDocument = useMemo(() => {
    const lastFile = loadLastOpenedFile();
    if (lastFile && window.inkpointNodeBridge?.exists(lastFile)) {
      try {
        const content = window.inkpointNodeBridge.readFile(lastFile);
        return {
          markdown: content,
          savedMarkdown: content,
          filePath: lastFile,
        };
      } catch {
        // 忽略读取异常
      }
    }
    return {
      markdown: "",
      savedMarkdown: "",
      filePath: null,
    };
  }, []);

  const docState: DocumentState = useMemo(() => {
    return createDocumentState({
      markdown: initialDocument.markdown,
      savedMarkdown: initialDocument.savedMarkdown,
      filePath: initialDocument.filePath,
      mode: "wysiwyg",
    });
  }, [initialDocument]);

  const subscribeSnapshot = useCallback(
    (onStoreChange: () => void) => docState.subscribeSnapshot(onStoreChange),
    [docState],
  );
  const getSnapshot = useCallback(() => docState.getSnapshot(), [docState]);
  const snapshot = useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsBeforeDialogRef = useRef(settings);
  const folderRef = useRef(folder);
  folderRef.current = folder;

  const showToast = useCallback((msg: string | null) => {
    setToastMessage(msg);
    if (msg) {
      setTimeout(() => setToastMessage(null), 2400);
    }
  }, []);

  // 设置窗口内先即时预览，保存时再持久化，取消则回滚到打开前状态。
  const handleUpdateSettings = useCallback(
    (updater: Partial<UtoolsSettings> | ((prev: UtoolsSettings) => UtoolsSettings)) => {
      setSettings((prev) => {
        return typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      });
    },
    [],
  );

  const handleOpenSettings = useCallback(() => {
    settingsBeforeDialogRef.current = settingsRef.current;
    setIsSettingsOpen(true);
  }, []);

  const handleCancelSettings = useCallback(() => {
    setSettings(settingsBeforeDialogRef.current);
    setIsSettingsOpen(false);
  }, []);

  const handleSaveSettings = useCallback(() => {
    const next = settingsRef.current;
    saveUtoolsSettings(next);
    settingsBeforeDialogRef.current = next;
    setIsSettingsOpen(false);
  }, []);

  // 主题应用逻辑
  const applyTheme = useCallback((theme: "system" | "light" | "dark") => {
    let isDark = false;
    if (theme === "dark") {
      isDark = true;
    } else if (theme === "light") {
      isDark = false;
    } else {
      // 跟随系统主题
      if (typeof window !== "undefined" && window.utools?.isDarkColors) {
        isDark = window.utools.isDarkColors();
      } else if (typeof window !== "undefined") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
    }
    applyResolvedUtoolsTheme(document.documentElement, resolveUtoolsTheme(theme, isDark));
  }, []);

  // 响应主题切换
  useEffect(() => {
    applyTheme(settings.theme);

    if (settings.theme === "system" && typeof window !== "undefined") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
  }, [applyTheme, settings.theme]);

  const [rendererPorts, setRendererPorts] = useState<CodeMirrorEditorPorts | null>(null);

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
    if (result.ok) {
      showToast(nextMode === "source" ? "已切换至源码模式" : "已切换至所见即所得");
    } else {
      showToast(`切换失败: ${result.message}`);
    }
  }, [docState, rendererPorts, showToast, snapshot.mode]);

  // 1. 本地文件保存操作（对齐桌面端 file.save）
  const handleSaveDocument = useCallback(async (): Promise<boolean> => {
    const current = docState.getSnapshot();
    let targetPath = current.filePath;

    if (!targetPath) {
      if (typeof window === "undefined" || !window.utools) {
        showToast("当前环境不支持文件保存窗口");
        return false;
      }
      const chosen = window.utools.showSaveDialog({
        title: "保存 Markdown 文档",
        defaultPath: "未命名.md",
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
        buttonLabel: "保存",
      });
      if (!chosen) {
        return false;
      }
      targetPath = chosen;
    }

    if (window.inkpointNodeBridge) {
      try {
        window.inkpointNodeBridge.writeFile(targetPath, current.markdown);
        docState.replaceDocument(
          {
            markdown: current.markdown,
            savedMarkdown: current.markdown,
            filePath: targetPath,
            mode: current.mode,
          },
          { kind: "command", commandId: "file.save" },
        );
        saveLastOpenedFile(targetPath);

        // 若当前工作区包含该文件，刷新工作区目录树
        const activeFolder = folderRef.current;
        if (activeFolder && targetPath.startsWith(activeFolder.rootPath)) {
          try {
            const updated = window.inkpointNodeBridge.scanFolder(activeFolder.rootPath);
            setFolder(updated);
          } catch {
            // 忽略
          }
        }

        showToast("文件已保存");
        return true;
      } catch (err) {
        showToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    }
    return false;
  }, [docState, showToast]);

  // 2. 本地文件自动防抖保存逻辑（当已关联本地文件且内容修改时自动刷盘）
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
        try {
          window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
          docState.replaceDocument(
            {
              markdown: current.markdown,
              savedMarkdown: current.markdown,
              filePath: current.filePath,
              mode: current.mode,
            },
            { kind: "command", commandId: "file.autoSave" },
          );
        } catch (err) {
          console.error("自动保存文件失败:", err);
        }
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [docState, snapshot.markdown]);

  // 3. 用户点击新建文档（对齐桌面端 file.new）
  const handleNewFile = useCallback(() => {
    const current = docState.getSnapshot();
    if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
      try {
        window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
      } catch {
        // 忽略
      }
    }
    docState.replaceDocument(
      {
        markdown: "",
        savedMarkdown: "",
        filePath: null,
        mode: snapshotRef.current.mode,
      },
      { kind: "command", commandId: "file.new" },
    );
    clearLastOpenedFile();
    setMode("file");
    showToast("已新建空白文档");
  }, [docState, showToast]);

  // 4. 注册 uTools 生命周期监听
  useEffect(() => {
    const handleEnter = (detail: PluginEnterDetail) => {
      applyTheme(settingsRef.current.theme);

      // 场景 A: 完整工作区模式 (从已安装插件中心打开、搜索 Inkpoint/工作区/workspace)
      if (detail.code === "workspace") {
        setIsSidebarOpen(true);
        const lastFolder = loadLastOpenedFolder();
        if (
          lastFolder &&
          window.inkpointNodeBridge &&
          window.inkpointNodeBridge.isDirectory(lastFolder)
        ) {
          try {
            const scanned = window.inkpointNodeBridge.scanFolder(lastFolder);
            setFolder(scanned);

            const lastFile = loadLastOpenedFile();
            const targetFile =
              lastFile &&
              lastFile.startsWith(lastFolder) &&
              window.inkpointNodeBridge.exists(lastFile)
                ? lastFile
                : findFirstMarkdown(scanned.tree)?.path;

            if (targetFile) {
              const content = window.inkpointNodeBridge.readFile(targetFile);
              docState.replaceDocument(
                {
                  markdown: content,
                  savedMarkdown: content,
                  filePath: targetFile,
                  mode: snapshotRef.current.mode,
                },
                { kind: "command", commandId: "utools.openWorkspace" },
              );
              saveLastOpenedFile(targetFile);
            }
            showToast(`已恢复工作区: ${scanned.rootName}`);
            return;
          } catch (err) {
            console.error("恢复工作区异常:", err);
          }
        }
        return;
      }

      // 场景 B: 匹配文件夹 (打开 Markdown 文件夹/工作区)
      if (detail.code === "open-folder") {
        const fileList = detail.payload;
        if (Array.isArray(fileList) && fileList.length > 0) {
          const target = fileList[0];
          const dirPath = typeof target === "string" ? target : target.path;
          if (dirPath && window.inkpointNodeBridge) {
            try {
              const scanned = window.inkpointNodeBridge.scanFolder(dirPath);
              setFolder(scanned);
              setIsSidebarOpen(true);
              saveLastOpenedFolder(dirPath);

              const firstMd = findFirstMarkdown(scanned.tree);
              if (firstMd) {
                const content = window.inkpointNodeBridge.readFile(firstMd.path);
                docState.replaceDocument(
                  {
                    markdown: content,
                    savedMarkdown: content,
                    filePath: firstMd.path,
                    mode: snapshotRef.current.mode,
                  },
                  { kind: "command", commandId: "utools.openFolderFile" },
                );
                saveLastOpenedFile(firstMd.path);
              }
              showToast(`已加载工作区: ${scanned.rootName}`);
              return;
            } catch (err) {
              console.error("加载文件夹异常:", err);
            }
          }
        }
      }

      // 场景 C: 匹配文件 (打开本地 Markdown 文件)
      if (detail.code === "open-file" || detail.type === "file") {
        const fileList = detail.payload;
        if (Array.isArray(fileList) && fileList.length > 0) {
          const targetFile = fileList[0];
          const targetPath = typeof targetFile === "string" ? targetFile : targetFile.path;
          if (targetPath && window.inkpointNodeBridge) {
            try {
              const content = window.inkpointNodeBridge.readFile(targetPath);
              docState.replaceDocument(
                {
                  markdown: content,
                  savedMarkdown: content,
                  filePath: targetPath,
                  mode: snapshotRef.current.mode,
                },
                { kind: "command", commandId: "utools.openFile" },
              );
              setMode("file");
              saveLastOpenedFile(targetPath);

              // 为其所在父级目录构建文件树并展开侧边栏
              const parentDir = window.inkpointNodeBridge.getDirname(targetPath);
              if (parentDir && window.inkpointNodeBridge.isDirectory(parentDir)) {
                try {
                  const scanned = window.inkpointNodeBridge.scanFolder(parentDir);
                  setFolder(scanned);
                  setIsSidebarOpen(true);
                  saveLastOpenedFolder(parentDir);
                } catch {
                  // 忽略扫描失败
                }
              }

              showToast(`已打开文件: ${targetPath.split(/[/\\]/).pop()}`);
              return;
            } catch (err) {
              console.error("打开本地文件异常:", err);
            }
          }
        }
      }

      // 场景 D: 划词进入 (超级面板匹配任意文本)
      if (detail.code === "selection-edit" || detail.type === "over") {
        const text = typeof detail.payload === "string" ? detail.payload : "";
        if (text) {
          docState.replaceDocument(
            {
              markdown: text,
              savedMarkdown: "",
              filePath: null,
              mode: snapshotRef.current.mode,
            },
            { kind: "command", commandId: "utools.selectionEdit" },
          );
          setMode("selection");
          setIsSidebarOpen(false);
          showToast("已导入选中文字");
          return;
        }
      }
    };

    const handleOut = () => {
      // 插件退出到后台时，强制刷盘未保存内容
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
        try {
          window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
        } catch {
          // 忽略
        }
      }
    };

    const cleanup = registerUtoolsLifecycle({
      onEnter: handleEnter,
      onOut: handleOut,
    });

    return cleanup;
  }, [applyTheme, docState, showToast]);

  // 4. 用户点击打开本地文件
  const handleOpenFile = useCallback(() => {
    if (typeof window === "undefined" || typeof window.utools === "undefined") {
      showToast("当前环境不支持文件选择器");
      return;
    }
    const paths = window.utools.showOpenDialog({
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
      properties: ["openFile"],
    });
    if (!paths || paths.length === 0) {
      return;
    }
    const targetPath = paths[0];
    if (window.inkpointNodeBridge) {
      try {
        const content = window.inkpointNodeBridge.readFile(targetPath);
        docState.replaceDocument(
          {
            markdown: content,
            savedMarkdown: content,
            filePath: targetPath,
            mode: snapshotRef.current.mode,
          },
          { kind: "command", commandId: "utools.openFilePicker" },
        );
        setMode("file");

        // 自动挂载该文件所属文件夹并展开侧栏
        const parentDir = window.inkpointNodeBridge.getDirname(targetPath);
        if (parentDir && window.inkpointNodeBridge.isDirectory(parentDir)) {
          try {
            const scanned = window.inkpointNodeBridge.scanFolder(parentDir);
            setFolder(scanned);
            setIsSidebarOpen(true);
          } catch {
            // 忽略
          }
        }

        showToast(`已加载本地文件`);
      } catch (err) {
        showToast(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [docState, showToast]);

  // 5. 用户点击打开本地文件夹
  const handleOpenFolder = useCallback(() => {
    if (typeof window === "undefined" || typeof window.utools === "undefined") {
      showToast("当前环境不支持选择文件夹");
      return;
    }
    const paths = window.utools.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!paths || paths.length === 0) return;
    const targetDir = paths[0];
    if (window.inkpointNodeBridge) {
      try {
        const scanned = window.inkpointNodeBridge.scanFolder(targetDir);
        setFolder(scanned);
        setIsSidebarOpen(true);
        setMode("file");
        saveLastOpenedFolder(targetDir);

        const firstMd = findFirstMarkdown(scanned.tree);
        if (firstMd) {
          const content = window.inkpointNodeBridge.readFile(firstMd.path);
          docState.replaceDocument(
            {
              markdown: content,
              savedMarkdown: content,
              filePath: firstMd.path,
              mode: snapshotRef.current.mode,
            },
            { kind: "command", commandId: "utools.openFolderPicker" },
          );
        }
        showToast(`已打开文件夹: ${scanned.rootName}`);
      } catch (err) {
        showToast(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [docState, showToast]);

  // 5. 选中文件树中的文件
  const handleSelectTreeFile = useCallback(
    (path: string) => {
      if (path === docState.getSnapshot().filePath) return;
      const current = docState.getSnapshot();
      if (current.filePath && current.isDirty && window.inkpointNodeBridge) {
        try {
          window.inkpointNodeBridge.writeFile(current.filePath, current.markdown);
        } catch (err) {
          console.error("保存旧文件失败:", err);
        }
      }
      if (window.inkpointNodeBridge) {
        try {
          const content = window.inkpointNodeBridge.readFile(path);
          docState.replaceDocument(
            {
              markdown: content,
              savedMarkdown: content,
              filePath: path,
              mode: snapshotRef.current.mode,
            },
            { kind: "command", commandId: "utools.selectTreeFile" },
          );
          setMode("file");
          saveLastOpenedFile(path);
        } catch (err) {
          showToast(`读取失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
    [docState, showToast],
  );

  // 6. 在文件树中新建文件/文件夹
  const handleCreateTreeItem = useCallback(
    async (parentPath: string, name: string, kind: "markdown" | "directory") => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        const createdPath = window.inkpointNodeBridge.createTreeItem(parentPath, name, kind);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        if (kind === "markdown") {
          handleSelectTreeFile(createdPath);
        }
        showToast(`已创建 ${name}`);
      } catch (err) {
        showToast(`创建失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [folder, handleSelectTreeFile, showToast],
  );

  // 7. 删除文件树节点
  const handleDeleteTreeNode = useCallback(
    async (path: string) => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        window.inkpointNodeBridge.deleteTreeItem(path);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        const currentSnap = docState.getSnapshot();
        if (
          currentSnap.filePath === path ||
          (currentSnap.filePath && currentSnap.filePath.startsWith(path + "/"))
        ) {
          handleNewFile();
        }
        showToast("已删除");
      } catch (err) {
        showToast(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, handleNewFile, showToast],
  );

  // 8. 重命名文件树节点
  const handleRenameTreeItem = useCallback(
    async (oldPath: string, newName: string) => {
      if (!folder || !window.inkpointNodeBridge) return;
      try {
        const newPath = window.inkpointNodeBridge.renameTreeItem(oldPath, newName);
        const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
        setFolder(updated);
        const currentSnap = docState.getSnapshot();
        // 若当前打开的文件被重命名，或所在目录被重命名，同步更新文档状态与最近打开文件
        if (currentSnap.filePath === oldPath) {
          docState.replaceDocument(
            {
              markdown: currentSnap.markdown,
              savedMarkdown: currentSnap.savedMarkdown,
              filePath: newPath,
              mode: currentSnap.mode,
            },
            { kind: "command", commandId: "file.rename" },
          );
          saveLastOpenedFile(newPath);
        } else if (currentSnap.filePath && currentSnap.filePath.startsWith(oldPath + "/")) {
          const newDocPath = newPath + currentSnap.filePath.slice(oldPath.length);
          docState.replaceDocument(
            {
              markdown: currentSnap.markdown,
              savedMarkdown: currentSnap.savedMarkdown,
              filePath: newDocPath,
              mode: currentSnap.mode,
            },
            { kind: "command", commandId: "file.rename" },
          );
          saveLastOpenedFile(newDocPath);
        }
        showToast(`已重命名为 ${newName}`);
      } catch (err) {
        showToast(`重命名失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, folder, showToast],
  );

  // 9. 刷新目录树
  const handleRefreshFolder = useCallback(() => {
    if (!folder || !window.inkpointNodeBridge) return;
    try {
      const updated = window.inkpointNodeBridge.scanFolder(folder.rootPath);
      setFolder(updated);
      showToast("目录树已刷新");
    } catch (err) {
      showToast(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [folder, showToast]);

  // 9. 贴回原应用
  const handlePasteBackToApp = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.utools !== "undefined") {
      window.utools.hideMainWindowPasteText(snapshot.markdown);
    }
  }, [snapshot.markdown]);

  // 10. 图片粘贴与拖拽导入处理（对齐桌面端 ensureDocumentSaved 与 assets/ 规范）
  const handleInsertImageFile = useCallback(
    async (file: File) => {
      let current = docState.getSnapshot();
      const altText = imageAltTextFromFileName(file.name) || "image";

      // 如果尚未保存文档，要求先保存以计算稳定相对目录（对齐桌面端设计）
      if (!current.filePath) {
        const saved = await handleSaveDocument();
        if (!saved) {
          showToast("请先保存文档再插入本地图片");
          return;
        }
        current = docState.getSnapshot();
      }

      if (!current.filePath || !window.inkpointNodeBridge?.savePastedImage) {
        showToast("当前环境不支持保存本地图片");
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const res = window.inkpointNodeBridge.savePastedImage(
          current.filePath,
          file.type || "image/png",
          buffer,
          file.name,
        );

        const targetSrc = res.markdownPath;
        const cursorPos = rendererPorts?.getSelectionSnapshot().head;
        const tag = `![${altText}](${targetSrc})`;
        let nextMarkdown: string;
        if (
          cursorPos !== undefined &&
          cursorPos !== null &&
          cursorPos >= 0 &&
          cursorPos <= current.markdown.length
        ) {
          const before = current.markdown.slice(0, cursorPos);
          const after = current.markdown.slice(cursorPos);
          const needsPrefixNewline = before.length > 0 && !before.endsWith("\n");
          const needsSuffixNewline = after.length > 0 && !after.startsWith("\n");
          nextMarkdown = `${before}${needsPrefixNewline ? "\n\n" : ""}${tag}${needsSuffixNewline ? "\n\n" : ""}${after}`;
        } else {
          nextMarkdown = appendImageMarkdown(current.markdown, targetSrc, altText);
        }

        docState.replaceDocument(
          {
            markdown: nextMarkdown,
            savedMarkdown: current.savedMarkdown,
            filePath: current.filePath,
            mode: current.mode,
          },
          { kind: "command", commandId: "editor.insertImage" },
        );

        showToast(`图片已保存至 ${res.markdownPath}`);

        // 刷新目录树以显示新生成的 assets 资产
        const activeFolder = folderRef.current;
        if (activeFolder && window.inkpointNodeBridge) {
          try {
            const updated = window.inkpointNodeBridge.scanFolder(activeFolder.rootPath);
            setFolder(updated);
          } catch {
            // 忽略刷新异常
          }
        }
      } catch (err) {
        showToast(`保存本地图片失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [docState, handleSaveDocument, rendererPorts, showToast],
  );

  // 11. 监听剪贴板粘贴图片与拖拽图片事件
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

  // 12. 图片预览路径解析（直接从 docState 同步读取，杜绝 React Ref 延迟，配合 preload 转 Data URL）
  const resolveImage = useCallback(
    (src: string) => {
      if (!src) return src;
      if (
        src.startsWith("data:") ||
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("file://") ||
        src.startsWith("#")
      ) {
        return src;
      }

      // 核心原则：直接从文档状态机同步获取 filePath，绝不使用 React Ref 避免 decoration 阶段脱节
      const currentPath = docState.getSnapshot().filePath;
      const workspaceRoot = folder?.rootPath;

      // 优先通过 preload bridge 转为 data URL（同步调用，完全跨平台）
      if (window.inkpointNodeBridge?.resolveImageSrc) {
        const resolved = window.inkpointNodeBridge.resolveImageSrc(
          currentPath ?? "",
          src,
          workspaceRoot,
        );
        // 如果 bridge 解析失败（文件不存在），返回原始 src
        if (resolved && resolved !== src) {
          return resolved;
        }
      }

      // Fallback：Electron/uTools 支持 file:// 协议，将相对路径转为绝对路径
      // 这在 bridge 不可用或解析失败时提供兜底
      if (currentPath) {
        try {
          // 根据当前文档路径计算图片绝对路径
          // path.resolve 只在 Node.js 中有，Electron 渲染进程无法直接用
          // 改用字符串处理（浏览器级别的相对路径解析）
          const docDir = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);
          if (docDir) {
            const cleanSrc = src.startsWith("./") ? src.slice(2) : src;
            return `file://${docDir}${cleanSrc}`;
          }
        } catch {
          // 忽略路径解析异常
        }
      }

      return src;
    },
    [docState, folder?.rootPath],
  );

  // 13. 全局快捷键与应用内快捷键监听（严格对齐桌面端快捷键映射）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: 关闭设置弹窗或免责声明浮层
      if (e.key === "Escape") {
        if (isSettingsOpen) {
          handleCancelSettings();
          return;
        }
        if (isDisclaimerOpen) {
          setIsDisclaimerOpen(false);
          return;
        }
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      // 1. Cmd+, 或 Ctrl+,: 打开偏好设置 (对齐桌面端与 Mac 经典偏好设置快捷键)
      if (e.key === "," || key === ",") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleOpenSettings();
        return;
      }

      // 2. Cmd+/ 或 Ctrl+/: 切换源码 / 所见即所得模式 (对齐桌面端 view.toggleSource)
      // 捕获阶段拦截并阻止向下透传至 CodeMirror，防止触发 CodeMirror 默认的 toggleComment (注释 <!-- -->)
      if (e.key === "/" || key === "/") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleSourceMode();
        return;
      }

      // 3. Cmd+1 或 Ctrl+1: 切换至所见即所得模式 (对齐桌面端 view.showWysiwyg)
      if (key === "1" && !e.shiftKey && !e.altKey) {
        if (snapshotRef.current.mode === "source") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          toggleSourceMode();
          return;
        }
      }

      // 4. Cmd+Shift+B 或 Ctrl+Shift+B: 展开 / 收起侧边栏文件树 (对齐桌面端 view.toggleSidebarPrimary)
      // 同时兼容 Cmd+\ 保证老习惯不失效
      if ((key === "b" && e.shiftKey) || e.key === "\\" || key === "\\") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      // 5. Cmd+N 或 Ctrl+N: 新建空白文档 (对齐桌面端 file.new)
      if (key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleNewFile();
        return;
      }

      // 6. Cmd+O 或 Ctrl+O: 打开文件；带 Shift (Cmd+Shift+O) 为打开文件夹 (对齐桌面端 file.open & file.openFolder)
      if (key === "o") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.shiftKey) {
          handleOpenFolder();
        } else {
          handleOpenFile();
        }
        return;
      }

      // 7. Cmd+Enter 或 Ctrl+Enter: 贴回原活动应用 (uTools 专属高效流)
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handlePasteBackToApp();
        return;
      }

      // 8. Cmd+S 或 Ctrl+S: 立即写盘保存 (对齐桌面端 file.save)
      if (key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void handleSaveDocument();
        return;
      }
    };

    // 使用 capture: true 在捕获阶段顶层拦截快捷键，杜绝子级编辑器拦截产生意外副作用
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handlePasteBackToApp,
    handleSaveDocument,
    handleCancelSettings,
    handleOpenSettings,
    isDisclaimerOpen,
    isSettingsOpen,
    toggleSourceMode,
  ]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--theme-bg)] text-[var(--theme-text)]">
      {/* 顶部导流横幅 */}
      <ReferralBanner />

      {/* 主工作区：左侧文件树抽屉 + 右侧编辑器 */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {isSidebarOpen && (
          <UtoolsFileTree
            folder={folder}
            activeFilePath={snapshot.filePath}
            onSelectFile={handleSelectTreeFile}
            onCreateItem={handleCreateTreeItem}
            onRenameItem={handleRenameTreeItem}
            onDeleteNode={handleDeleteTreeNode}
            onRefresh={handleRefreshFolder}
            onToast={showToast}
            onCloseFolder={() => {
              setFolder(null);
              setIsSidebarOpen(false);
              clearLastOpenedFolder();
            }}
            onOpenFolder={handleOpenFolder}
          />
        )}

        {/* 编辑器核心区域 */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative select-text">
          <EditorUiProvider markdown={snapshot.markdown} showToast={showToast}>
            <CodeMirrorEditor
              document={docState}
              codeBlockLineNumbers={false}
              fontSize={settings.fontSize}
              proseFontFamily={resolveProseFontStack(settings.proseFontFamily)}
              codeFontFamily={resolveCodeFontStack(settings.codeFontFamily)}
              resolveImageSrc={resolveImage}
              syntaxPlugins={UTOOLS_SYNTAX_PLUGINS}
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
        folder={folder}
        isSidebarOpen={isSidebarOpen}
        charCount={snapshot.markdown.length}
        editorMode={snapshot.mode}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onToggleSourceMode={toggleSourceMode}
        onOpenSettings={handleOpenSettings}
      />

      {/* 轻量 Toast 提示 */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-[var(--theme-title)] text-[var(--theme-surface)] text-xs shadow-md pointer-events-none transition-all"
        >
          {toastMessage}
        </div>
      )}

      {/* 设置菜单与偏好弹窗（整合外观排版、快捷键速查与 uTools 全局指南） */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onCancel={handleCancelSettings}
        onSave={handleSaveSettings}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* AI 安全与免责声明弹窗 */}
      <DisclaimerModal
        isOpen={isDisclaimerOpen}
        onAccept={() => setIsDisclaimerOpen(false)}
        onClose={() => setIsDisclaimerOpen(false)}
      />
    </div>
  );
}
