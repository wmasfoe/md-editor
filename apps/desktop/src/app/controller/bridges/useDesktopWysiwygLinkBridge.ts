import { useCallback, useLayoutEffect } from "react";
import { fileService } from "../../../desktop/file-service";
import { inspectLinkedFileTarget, openExternalTarget } from "../../../desktop/link-service";
import {
  isExternalSchemeLink,
  isHttpLink,
  normalizeLocalHrefPath,
  splitLinkHref
} from "../../../lib/link-target";
import type { RunFileAction } from "@md-editor/editor-ui";
import { runtime } from "../../runtime/editor-runtime";
import { useDocumentUiStore } from "../../stores/document-ui-store";
import type { DocumentActionsController } from "../useDocumentActionsController";

interface UseDesktopWysiwygLinkBridgeOptions {
  readonly documentActions: Pick<DocumentActionsController, "ensureDiscardAllowed" | "replaceDocument">;
  readonly jumpToMarkdownFragment: (markdown: string, fragment: string) => void;
  readonly openAssetPath: (path: string, name?: string) => void;
  readonly refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  readonly runFileAction: RunFileAction;
  readonly showToast: (message: string | null) => void;
}

export function useDesktopWysiwygLinkBridge({
  documentActions,
  jumpToMarkdownFragment,
  openAssetPath,
  refreshFolderForDocumentPath,
  runFileAction,
  showToast,
}: UseDesktopWysiwygLinkBridgeOptions) {
  const { ensureDiscardAllowed, replaceDocument } = documentActions;

  // WYSIWYG 链接点击横跨 editor-ui 选区、desktop 文件服务和外部打开能力，所以用独立 bridge 收口。
  const openWysiwygLink = useCallback(async (href: string) => {
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
        normalizeLocalHrefPath(parts.path)
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
  }, [
    ensureDiscardAllowed,
    jumpToMarkdownFragment,
    openAssetPath,
    replaceDocument,
    refreshFolderForDocumentPath,
    runFileAction,
    showToast,
  ]);

  // preview/editor 组件只通过 store 调用 openWysiwygLink，不需要知道 provider/runtime 装配细节。
  useLayoutEffect(() => {
    useDocumentUiStore.setState({ openWysiwygLink });
  }, [openWysiwygLink]);

  return openWysiwygLink;
}
