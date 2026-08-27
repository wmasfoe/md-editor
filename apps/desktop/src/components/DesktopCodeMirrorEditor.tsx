import {
  CodeMirrorEditor,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "@md-editor/editor-ui";
import { runtime } from "../app/runtime/editor-runtime";
import { useAppSettings } from "../app/settings-context";
import { useDesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { inspectLinkedFileTarget, openExternalTarget } from "../desktop/link-service";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";

import {
  resolveCodeFontStack,
  resolveProseFontStack,
} from "../app/settings/app-settings";

export interface DesktopCodeMirrorEditorProps {
  readonly hidden?: boolean;
  readonly onRendererPortsChange?: (ports: CodeMirrorEditorPorts | null) => void;
  readonly showToast: (message: string | null) => void;
}

export function DesktopCodeMirrorEditor({
  hidden = false,
  onRendererPortsChange,
  showToast,
}: DesktopCodeMirrorEditorProps) {
  const { settings } = useAppSettings();
  const { openDocumentFromTree } = useDesktopEditorActions();

  // 链接打开:内部 markdown 文件在当前应用内打开,其余(资产/外部 URL)走系统打开。
  // 判定委托给 Rust 侧 inspect_linked_file(相对路径按当前文档目录解析)。
  const handleOpenLink = (url: string): void => {
    void (async () => {
      try {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
          // 显式协议(http/https/mailto 等)→ 系统浏览器/默认处理
          await openExternalTarget(url);
          return;
        }
        const documentPath = runtime.document.getSnapshot().filePath ?? "";
        const target = await inspectLinkedFileTarget(documentPath, url);
        if (target.kind === "markdown") {
          await openDocumentFromTree(target.path);
        } else {
          await openExternalTarget(target.path);
        }
      } catch {
        // 解析失败不打断编辑器(链接已过渲染层协议白名单,这里只兜底)
        showToast(`无法打开链接：${url}`);
      }
    })();
  };

  return (
    <CodeMirrorEditor
      document={runtime.document}
      className="min-h-0 flex-1"
      fontSize={settings.editor.wysiwygFontSize}
      proseFontFamily={resolveProseFontStack(settings.editor.proseFontFamily)}
      codeFontFamily={resolveCodeFontStack(settings.editor.codeFontFamily)}
      hidden={hidden}
      codeBlockLineNumbers={settings.editor.showCodeBlockLineNumbers}
      resolveImageSrc={(source) =>
        resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, source)
      }
      openLinkTarget={handleOpenLink}
      onRendererPortsChange={onRendererPortsChange}
      onQueuedExternalEditResult={(result) => reportQueuedEditResult(result, showToast)}
      onSyncError={(error) => reportSyncError(error, showToast)}
    />
  );
}

function reportQueuedEditResult(
  result: CodeMirrorEditorExternalEditResult,
  showToast: (message: string | null) => void,
): void {
  if (result.status === "applied" || result.status === "noop") {
    return;
  }
  if (result.status === "cancelled" && result.reason === "superseded") {
    return;
  }
  showToast(`延迟编辑未能完成：${result.status}。`);
}

function reportSyncError(
  error: CodeMirrorEditorSyncError,
  showToast: (message: string | null) => void,
): void {
  const detail = error.kind === "renderer-sync" ? error.delivery.status : error.result.status;
  showToast(`编辑器同步失败：${detail}。请重新打开当前文档。`);
}
