import {
  CodeMirrorEditor,
  type CodeMirrorEditorExternalEditResult,
  type CodeMirrorEditorPorts,
  type CodeMirrorEditorSyncError,
} from "@md-editor/editor-ui";
import { runtime } from "../app/runtime/editor-runtime";
import { useAppSettings } from "../app/settings-context";
import { resolvePreviewImageSrc } from "../lib/markdown-preview";

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

  return (
    <CodeMirrorEditor
      document={runtime.document}
      className="min-h-0 flex-1"
      fontSize={settings.editor.wysiwygFontSize}
      hidden={hidden}
      lineNumbers={settings.editor.showCodeBlockLineNumbers}
      resolveImageSrc={(source) =>
        resolvePreviewImageSrc(runtime.document.getSnapshot().filePath, source)
      }
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
