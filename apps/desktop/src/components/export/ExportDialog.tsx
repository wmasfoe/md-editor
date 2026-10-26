import { useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { runtime } from "../../app/runtime/editor-runtime";
import { useToastStore } from "../../app/stores/toast-store";
import {
  copyDocumentAsHtml,
  exportDocumentAsHtml,
  exportDocumentAsPdf,
} from "../../app/controller/export-controller";

export interface ExportDialogProps {
  readonly open: boolean;
  readonly defaultTab?: "html" | "pdf" | "copy";
  readonly onClose: () => void;
}

export function ExportDialog({ open, defaultTab = "html", onClose }: ExportDialogProps) {
  const [activeTab, setActiveTab] = useState<"html" | "pdf" | "copy">(defaultTab);
  const [pageSize, setPageSize] = useState<"A4" | "Letter">("A4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [margin, setMargin] = useState<"standard" | "compact" | "wide">("standard");
  const [isExporting, setIsExporting] = useState(false);
  const { showToast } = useToastStore();

  const handleExportHtml = async () => {
    setIsExporting(true);
    try {
      const snapshot = runtime.document.getSnapshot();
      const result = await exportDocumentAsHtml(snapshot.filePath, snapshot.markdown);
      if (result.success) {
        showToast(result.directory ? `已成功导出至: ${result.directory}` : "HTML 导出成功");
        onClose();
      } else if (result.message && result.message !== "已取消导出") {
        showToast(`导出失败: ${result.message}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      const snapshot = runtime.document.getSnapshot();
      const marginMap = {
        standard: "15mm 20mm",
        compact: "10mm 12mm",
        wide: "25mm 30mm",
      };
      const ok = await exportDocumentAsPdf(snapshot.filePath, snapshot.markdown, {
        pageSize,
        orientation,
        margin: marginMap[margin],
      });
      if (ok) {
        showToast("已调起打印系统（可在打印选项中选择“另存为 PDF”）");
        onClose();
      } else {
        showToast("调起打印失败");
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyHtml = async () => {
    const snapshot = runtime.document.getSnapshot();
    const ok = await copyDocumentAsHtml(snapshot.markdown);
    if (ok) {
      showToast("已复制富文本 HTML 至剪贴板");
      onClose();
    } else {
      showToast("复制失败");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.4)] backdrop-blur-[4px] transition-opacity" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel className="w-[min(520px,calc(100vw-2rem))] rounded-[16px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] p-6 shadow-[var(--theme-shadow)]">
          <DialogTitle className="m-0 mb-4 text-[16px] font-[650] text-[var(--theme-title)]">
            导出文档
          </DialogTitle>

          {/* 选项卡头部 */}
          <div className="flex border-b border-[var(--theme-border)] pb-2 mb-4 gap-4">
            <button
              type="button"
              onClick={() => setActiveTab("html")}
              className={`pb-1 text-[13.5px] font-medium transition-colors border-b-2 ${
                activeTab === "html"
                  ? "border-[var(--theme-primary)] text-[var(--theme-title)]"
                  : "border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              }`}
            >
              导出 HTML
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pdf")}
              className={`pb-1 text-[13.5px] font-medium transition-colors border-b-2 ${
                activeTab === "pdf"
                  ? "border-[var(--theme-primary)] text-[var(--theme-title)]"
                  : "border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              }`}
            >
              导出 PDF
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("copy")}
              className={`pb-1 text-[13.5px] font-medium transition-colors border-b-2 ${
                activeTab === "copy"
                  ? "border-[var(--theme-primary)] text-[var(--theme-title)]"
                  : "border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
              }`}
            >
              复制为 HTML
            </button>
          </div>

          {/* 选项卡内容 */}
          {activeTab === "html" && (
            <div className="space-y-3 text-[13px] text-[var(--theme-text)]">
              <p className="leading-relaxed text-[var(--theme-muted)]">
                一键双模导出：将在指定目录下同时产出两个 HTML 文件，消除配置选择负担：
              </p>
              <div className="rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-code-bg,#f6f8fa)] p-3 space-y-1.5 font-mono text-[12px]">
                <div>
                  <span className="font-semibold text-[var(--theme-title)]">standalone.html</span>:
                  全内联独立文件（包含 Base64 图片与 CSS/KaTeX 样式），适合单文件直接邮件/微信发送。
                </div>
                <div>
                  <span className="font-semibold text-[var(--theme-title)]">index.html</span>:
                  标准外链结构（保留相对资源引用），适合静态站点与文档托管。
                </div>
              </div>
            </div>
          )}

          {activeTab === "pdf" && (
            <div className="space-y-4 text-[13px] text-[var(--theme-text)]">
              <p className="leading-relaxed text-[var(--theme-muted)]">
                注入专业排版样式与代码/表格/公式分页防截断保护规则，调用系统原生打印管道导出高质量
                PDF：
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[var(--theme-muted)] mb-1">
                    纸张尺寸
                  </label>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as "A4" | "Letter")}
                    className="w-full h-[32px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-input-bg,var(--theme-surface))] px-2 text-[13px] text-[var(--theme-title)]"
                  >
                    <option value="A4">A4 (210×297mm)</option>
                    <option value="Letter">US Letter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[var(--theme-muted)] mb-1">
                    页面方向
                  </label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as "portrait" | "landscape")}
                    className="w-full h-[32px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-input-bg,var(--theme-surface))] px-2 text-[13px] text-[var(--theme-title)]"
                  >
                    <option value="portrait">纵向 (Portrait)</option>
                    <option value="landscape">横向 (Landscape)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[var(--theme-muted)] mb-1">
                    页边距
                  </label>
                  <select
                    value={margin}
                    onChange={(e) => setMargin(e.target.value as "standard" | "compact" | "wide")}
                    className="w-full h-[32px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-input-bg,var(--theme-surface))] px-2 text-[13px] text-[var(--theme-title)]"
                  >
                    <option value="standard">标准边距</option>
                    <option value="compact">紧凑边距</option>
                    <option value="wide">宽松边距</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === "copy" && (
            <div className="space-y-3 text-[13px] text-[var(--theme-text)]">
              <p className="leading-relaxed text-[var(--theme-muted)]">
                将当前 Markdown 文档实时编译为包含完整排版样式的语义富文本 HTML，并写入系统剪贴板。
              </p>
              <p className="text-[12px] text-[var(--theme-muted)]">
                可无缝直接粘贴至飞书、语雀、微信公众号、Apple Mail、Outlook 等主流富文本编辑器。
              </p>
            </div>
          )}

          <div className="my-5 border-b border-[var(--theme-border)]" />

          {/* 底部按钮栏 */}
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className={dialogButtonClassName}
              onClick={onClose}
              disabled={isExporting}
            >
              取消
            </button>
            {activeTab === "html" && (
              <button
                type="button"
                className={primaryDialogButtonClassName}
                onClick={handleExportHtml}
                disabled={isExporting}
              >
                {isExporting ? "正在导出..." : "选择目录并导出"}
              </button>
            )}
            {activeTab === "pdf" && (
              <button
                type="button"
                className={primaryDialogButtonClassName}
                onClick={handleExportPdf}
                disabled={isExporting}
              >
                {isExporting ? "正在准备..." : "调起系统打印 / 另存为 PDF"}
              </button>
            )}
            {activeTab === "copy" && (
              <button
                type="button"
                className={primaryDialogButtonClassName}
                onClick={handleCopyHtml}
              >
                复制富文本至剪贴板
              </button>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
