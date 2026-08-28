import { useCallback, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorMode } from "@md-editor/editor-core";
import type { RuntimeFileService } from "@md-editor/file-system";
import { useDocumentSnapshot } from "../document-store";
import { useAppSettings } from "../settings-context";
import { bindDesktopMenuCommands, bindRuntimeKeyboardShortcuts } from "../events/command-bindings";
import { bindRecentFileMenuEvents } from "../events/recent-file-events";
import { bindBrowserDirtyDocumentGuard, bindTauriCloseGuard } from "../events/window-guards";
import { inspectLinkedFileTarget, openExternalTarget } from "../../desktop/link-service";
import { APP_DISPLAY_NAME } from "../../lib/app-name";
import {
  isExternalSchemeLink,
  isHttpLink,
  normalizeLocalHrefPath,
  splitLinkHref,
} from "../../lib/link-target";
import { runtime } from "../runtime/editor-runtime";
import { recentFilesStore } from "./recent-files-store";
import { getAiCompletionReadiness, requestAiContinuation } from "@md-editor/ai";
import { isDiscardProtectionRequired } from "./document-save";
import { useDocumentActionsController } from "./useDocumentActionsController";
import { unsupportedEditorUiCommandSlots, useEditorUiActions } from "@md-editor/editor-ui";
import { useConfirmationStore } from "../stores/confirmation-store";
import { useDocumentUiStore } from "../stores/document-ui-store";
import { useFileActionStore } from "../stores/file-action-store";
import { useFileTreeStore } from "../stores/file-tree-store";
import { useSidebarStore } from "../stores/sidebar-store";
import { isUpdateActionBusy, shouldShowEditorUpdateAction } from "../updates/update-status";
import type { DesktopEditorActions } from "../context/DesktopEditorActionsContext";

export interface UseDesktopEditorControllerInput {
  readonly fileService: RuntimeFileService;
  readonly showToast: (message: string | null) => void;
}

export function useDesktopEditorController({
  fileService,
  showToast,
}: UseDesktopEditorControllerInput): DesktopEditorActions {
  const {
    settings,
    updateStatus,
    openSettings,
    relaunchUpdate,
    downloadUpdate,
    applyDownloadedUpdate,
  } = useAppSettings();
  const snapshot = useDocumentSnapshot();
  const { getRendererPorts, jumpToMarkdownFragment } = useEditorUiActions();

  const setIsSidebarVisible = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    useSidebarStore.setState((state) => ({
      isSidebarVisible: typeof value === "function" ? value(state.isSidebarVisible) : value,
    }));
  }, []);

  const requestConfirmation = useConfirmationStore((state) => state.requestConfirmation);
  const hasPendingConfirmation = useConfirmationStore((state) => state.hasPendingConfirmation);
  const setHasActiveDocument = useDocumentUiStore((state) => state.setHasActiveDocument);
  const setOpenedAsset = useDocumentUiStore((state) => state.setOpenedAsset);
  const openAssetPath = useDocumentUiStore((state) => state.openAssetPath);
  const runFileAction = useFileActionStore((state) => state.runFileAction);
  const refreshFolderForDocumentPathWithService = useFileTreeStore(
    (state) => state.refreshFolderForDocumentPath,
  );
  const showOpenedFolder = useFileTreeStore((state) => state.showOpenedFolder);
  const refreshFolderForDocumentPath = useCallback(
    (documentPath: string) => refreshFolderForDocumentPathWithService(fileService, documentPath),
    [fileService, refreshFolderForDocumentPathWithService],
  );
  const docActions = useDocumentActionsController({
    fileService,
    getRendererPorts,
    refreshFolderForDocumentPath,
    requestConfirmation,
    runFileAction,
    setHasActiveDocument,
    setOpenedAsset,
    showOpenedFolder,
    showToast,
  });
  const {
    createNewDocument,
    ensureDiscardAllowed,
    openDocument,
    openDocumentFromTree,
    openFolder,
    openRecentDocument,
    openRecentFile,
    replaceDocument,
    saveDocument,
    switchMode: switchDocumentMode,
  } = docActions;

  const switchMode = useCallback(
    async (mode: EditorMode) => {
      await switchDocumentMode(mode);
    },
    [switchDocumentMode],
  );

  const toggleSourceMode = useCallback(async () => {
    const currentMode = runtime.document.getSnapshot().mode;
    await switchMode(currentMode === "source" ? "wysiwyg" : "source");
  }, [switchMode]);

  // --- dispatchCommand ---
  const dispatchCommand = useCallback(
    async (id: string) => {
      if (hasPendingConfirmation()) return;
      await runtime.commands.dispatch(id, {
        document: runtime.document,
        actions: {
          newDocument: createNewDocument,
          openDocument,
          openRecentDocument,
          openFolder,
          saveDocument: async () => {
            await saveDocument(false);
          },
          saveDocumentAs: async () => {
            await saveDocument(true);
          },
          openSettings,
          openMdxComponentMenu: async () => {
            const result = unsupportedEditorUiCommandSlots.openMdxComponentMenu();
            if (result?.status === "unsupported") {
              showToast("当前编辑器暂不支持插入 MDX 组件。");
            }
          },
          continueAiWriting: async () => {
            const portsAccess = getRendererPorts();
            if (portsAccess.status !== "available") {
              showToast("当前编辑器未就绪。");
              return;
            }
            const readiness = getAiCompletionReadiness(settings.ai, "continuation");
            if (readiness) {
              showToast(readiness);
              return;
            }
            const selection = portsAccess.ports.getSelectionSnapshot();
            const markdown = snapshot.markdown;
            const before = markdown.slice(0, selection.from);
            const after = markdown.slice(selection.to);
            const selectedText = selection.text;

            try {
              showToast("AI 续写思考中...");
              const suggestion = await requestAiContinuation(
                settings.ai,
                {
                  before,
                  after,
                  selectedText,
                  mode: snapshot.mode,
                  document: {
                    filePath: snapshot.filePath,
                  },
                },
                { intent: "continuation" },
              );

              if (suggestion.continuation) {
                portsAccess.ports.showSuggestion({
                  from: selection.from,
                  to: selection.to,
                  text: suggestion.continuation,
                });
                showToast("AI 续写建议已就绪，按 Tab 接受，Esc 取消。");
              } else {
                showToast("未能生成有效续写建议。");
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "AI 请求失败。";
              showToast(message);
            }
          },
          fixAiGrammar: async () => {
            const portsAccess = getRendererPorts();
            if (portsAccess.status !== "available") {
              showToast("当前编辑器未就绪。");
              return;
            }
            const readiness = getAiCompletionReadiness(settings.ai, "editing");
            if (readiness) {
              showToast(readiness);
              return;
            }
            const selection = portsAccess.ports.getSelectionSnapshot();
            const markdown = snapshot.markdown;
            let targetFrom = selection.from;
            let targetTo = selection.to;
            let selectedText = selection.text;

            // 若未选中文本，则自动选取光标所在的当前句子/整行进行分析
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

            try {
              showToast("AI 语法修复分析中...");
              const suggestion = await requestAiContinuation(
                settings.ai,
                {
                  before,
                  after,
                  selectedText,
                  mode: snapshot.mode,
                  document: {
                    filePath: snapshot.filePath,
                  },
                },
                { intent: "editing" },
              );

              if (suggestion.edit) {
                // 如果 LLM 返回的原文字段与选区匹配，则精确绑定范围
                let editFrom = targetFrom;
                let editTo = targetTo;
                if (suggestion.edit.original && selectedText.includes(suggestion.edit.original)) {
                  const offset = selectedText.indexOf(suggestion.edit.original);
                  editFrom = targetFrom + offset;
                  editTo = editFrom + suggestion.edit.original.length;
                }

                portsAccess.ports.showSuggestion({
                  from: editFrom,
                  to: editTo,
                  text: suggestion.edit.replacement,
                  originalText: suggestion.edit.original,
                  explanation: suggestion.edit.reason,
                });
                showToast(
                  suggestion.edit.reason
                    ? `AI 建议：${suggestion.edit.reason}（Tab 接受 · Esc 取消）`
                    : "AI 修复建议已就绪，按 Tab 接受，Esc 取消。",
                );
              } else {
                showToast("未发现明显语法、错别字或标点问题。");
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "AI 请求失败。";
              showToast(message);
            }
          },
          toggleSourceMode,
          showWysiwygMode: () => switchMode("wysiwyg"),
          toggleSidebarPrimary: () => setIsSidebarVisible((v) => !v),
        },
      });
    },
    [
      createNewDocument,
      getRendererPorts,
      hasPendingConfirmation,
      openDocument,
      openFolder,
      openRecentDocument,
      openSettings,
      saveDocument,
      settings.ai,
      setIsSidebarVisible,
      showToast,
      snapshot,
      switchMode,
      toggleSourceMode,
    ],
  );

  // --- runEditorUpdateAction ---
  const runEditorUpdateAction = useCallback(async () => {
    if (!shouldShowEditorUpdateAction(updateStatus) || isUpdateActionBusy(updateStatus)) {
      return;
    }

    let nextStatus = updateStatus;

    const ensureSavedBeforeApply = async () => {
      const current = runtime.document.getSnapshot();
      if (!isDiscardProtectionRequired(current)) {
        return true;
      }
      await requestConfirmation({
        title:
          current.persistenceStatus.kind === "verification-required"
            ? "保存结果仍需确认"
            : "请先保存文档",
        description:
          current.persistenceStatus.kind === "verification-required"
            ? "上一次保存结果无法确认。请再次保存并确认成功，再继续更新 App。"
            : "当前文档还有未保存的更改。请先保存，再继续更新 App。",
        confirmLabel: "知道了",
      });
      return false;
    };

    if (nextStatus.state === "available") {
      const choice = await requestConfirmation({
        title: "下载更新",
        description: `发现 ${APP_DISPLAY_NAME} ${nextStatus.latestVersion ?? "新版本"}。下载完成后，你可以继续退出并更新。`,
        confirmLabel: "下载更新",
      });
      if (choice !== "confirm") return;
      const result = await downloadUpdate();
      if (result.state !== "downloaded") return;
      nextStatus = result;
    }

    if (!(await ensureSavedBeforeApply())) return;

    if (nextStatus.state === "installed") {
      const choice = await requestConfirmation({
        title: "重启 App",
        description: "更新已安装。重启 App 后，新版本会生效。",
        confirmLabel: "重启 App",
      });
      if (choice === "confirm") await relaunchUpdate();
      return;
    }

    const choice = await requestConfirmation({
      title: "退出并更新",
      description: `${APP_DISPLAY_NAME} ${nextStatus.latestVersion ?? "新版本"} 已准备好。继续后会退出 App 并进行更新。`,
      confirmLabel: "退出并更新",
    });
    if (choice !== "confirm") return;

    const result = await applyDownloadedUpdate();
    if (result.state === "installed") await relaunchUpdate();
  }, [applyDownloadedUpdate, downloadUpdate, relaunchUpdate, requestConfirmation, updateStatus]);

  // --- openWysiwygLink ---
  const openWysiwygLink = useCallback(
    async (href: string) => {
      const parts = splitLinkHref(href);
      if (parts.path === "" && parts.fragment) {
        jumpToMarkdownFragment(runtime.document.getSnapshot().markdown, parts.fragment);
        return;
      }

      if (
        isHttpLink(href) ||
        (isExternalSchemeLink(href) && !href.trim().toLowerCase().startsWith("file:"))
      ) {
        await runFileAction("正在打开链接", async () => {
          await openExternalTarget(href);
        });
        return;
      }

      const current = runtime.document.getSnapshot();
      if (!current.filePath) {
        showToast("请先保存当前文档，再打开相对链接。");
        return;
      }

      await runFileAction("正在打开链接", async () => {
        const linked = await inspectLinkedFileTarget(
          current.filePath!,
          normalizeLocalHrefPath(parts.path),
        );

        if (linked.kind === "asset") {
          openAssetPath(linked.path);
          return;
        }

        if (linked.kind === "markdown") {
          if (!(await ensureDiscardAllowed())) return;
          const document = await fileService.openDocumentAtPath(linked.path);
          replaceDocument(document);
          await refreshFolderForDocumentPath(document.filePath);
          if (parts.fragment) {
            jumpToMarkdownFragment(document.markdown, parts.fragment);
          }
          return;
        }

        await openExternalTarget(linked.path);
      });
    },
    [
      ensureDiscardAllowed,
      fileService,
      jumpToMarkdownFragment,
      openAssetPath,
      refreshFolderForDocumentPath,
      replaceDocument,
      runFileAction,
      showToast,
    ],
  );

  // --- lifecycle bindings ---
  useEffect(
    () => bindRuntimeKeyboardShortcuts(dispatchCommand, settings),
    [dispatchCommand, settings],
  );
  useEffect(() => bindDesktopMenuCommands(dispatchCommand), [dispatchCommand]);
  useEffect(() => bindBrowserDirtyDocumentGuard(), []);
  useEffect(
    () =>
      bindTauriCloseGuard(() =>
        ensureDiscardAllowed("关闭应用前，你可以保存当前文档，或放弃尚未保存的更改。"),
      ),
    [ensureDiscardAllowed],
  );

  useEffect(
    () =>
      bindRecentFileMenuEvents({
        store: recentFilesStore,
        openRecentFile,
        onError: showToast,
      }),
    [openRecentFile, showToast],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const collapse = (event: MediaQueryListEvent) => {
      if (event.matches) setIsSidebarVisible(false);
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, [setIsSidebarVisible]);

  useEffect(() => {
    const fileName = snapshot.filePath?.split(/[\\/]/).pop() || "未命名文档";
    const title = `${fileName}${snapshot.isDirty ? "*" : ""}`;
    document.title = title;
    if (isTauri()) {
      void getCurrentWindow()
        .setTitle(title)
        .catch((error: unknown) => {
          console.warn("窗口标题同步失败", error);
        });
    }
  }, [snapshot.filePath, snapshot.isDirty]);

  return {
    dispatchCommand,
    openDocumentFromTree,
    openRecentFile,
    openWysiwygLink,
    runEditorUpdateAction,
  };
}
