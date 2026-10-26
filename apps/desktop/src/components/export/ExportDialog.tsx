/**
 * @file ExportDialog.tsx
 * @description
 * 文档导出模态对话框（HTML 双模导出、专业 PDF 防截断打印导出与剪贴板富文本复制）。
 * 遵循 Apple Liquid Glass 拟物材质与 macOS 桌面级分段选择器交互规范。
 */

import React, { useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { runtime } from "../../app/runtime/editor-runtime.ts";
import { useToastStore } from "../../app/stores/toast-store.ts";
import {
  copyDocumentAsHtml,
  exportDocumentAsHtml,
  exportDocumentAsPdf,
} from "../../app/controller/export-controller.ts";

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
      showToast("已复制富文本 HTML 至系统剪贴板");
      onClose();
    } else {
      showToast("复制失败");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[70]">
      {/* Liquid Glass 高斯模糊遮罩层 */}
      <DialogBackdrop className="fixed inset-0 bg-black/35 backdrop-blur-[10px] transition-opacity animate-in fade-in duration-200" />

      <div className="fixed inset-0 grid place-items-center p-4">
        {/* Apple 拟物液态玻璃面板 */}
        <DialogPanel className="w-[min(560px,calc(100vw-2rem))] rounded-[20px] border border-white/50 dark:border-white/10 bg-white/90 dark:bg-[#1c1e24]/90 backdrop-blur-[24px] saturate-[180%] p-6 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3),0_1px_1px_0_rgba(255,255,255,0.8)_inset] animate-in zoom-in-95 duration-180">
          {/* 对话框头部 */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <DialogTitle className="m-0 text-[16px] font-[650] text-[var(--theme-title)] tracking-tight">
                导出与分发
              </DialogTitle>
              <p className="mt-1 text-[12px] text-[var(--theme-muted)]">
                编译为独立 HTML、专业矢量 PDF 或通用富文本剪贴板格式
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-[var(--theme-muted)] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-[var(--theme-title)] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* macOS 拟物液态分段胶囊选择器 (Segmented Control) */}
          <div className="inline-flex w-full p-1 rounded-full bg-black/[0.05] dark:bg-white/[0.08] backdrop-blur-md mb-5">
            <button
              type="button"
              onClick={() => setActiveTab("html")}
              className={`flex-1 py-1.5 text-[12px] font-medium rounded-full transition-all text-center ${
                activeTab === "html"
                  ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_1px_rgba(255,255,255,0.8)_inset]"
                  : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
              }`}
            >
              HTML 导出
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pdf")}
              className={`flex-1 py-1.5 text-[12px] font-medium rounded-full transition-all text-center ${
                activeTab === "pdf"
                  ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_1px_rgba(255,255,255,0.8)_inset]"
                  : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
              }`}
            >
              PDF 打印 / 导出
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("copy")}
              className={`flex-1 py-1.5 text-[12px] font-medium rounded-full transition-all text-center ${
                activeTab === "copy"
                  ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_1px_rgba(255,255,255,0.8)_inset]"
                  : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
              }`}
            >
              复制为 HTML
            </button>
          </div>

          {/* 选项卡内容区 */}
          {activeTab === "html" && (
            <div className="space-y-3.5 text-[12.5px] text-[var(--theme-text)]">
              <p className="leading-relaxed text-[var(--theme-muted)] text-[12px]">
                一键双模导出：将在指定输出目录下同时构建两份 HTML 文件，免去繁琐的配置切换：
              </p>

              {/* standalone.html 卡片 */}
              <div className="rounded-[12px] border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] p-3.5 space-y-1.5 transition-all hover:border-[var(--theme-border-strong)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-[var(--theme-title)] text-[13px]">
                      standalone.html
                    </span>
                    <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium">
                      全内联独立版
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--theme-muted)]">适合邮件 / 微信传输</span>
                </div>
                <p className="text-[11.5px] text-[var(--theme-muted)] leading-relaxed m-0">
                  自动将文档内所有相对图片编译转码为 Base64 内联存储，集成完整 CSS 排版与 KaTeX
                  数学公式样式，单文件双击即开即读。
                </p>
              </div>

              {/* index.html 卡片 */}
              <div className="rounded-[12px] border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] p-3.5 space-y-1.5 transition-all hover:border-[var(--theme-border-strong)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-[var(--theme-title)] text-[13px]">
                      index.html
                    </span>
                    <span className="rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-[10px] font-medium">
                      标准外链站点
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--theme-muted)]">适合 Web 部署</span>
                </div>
                <p className="text-[11.5px] text-[var(--theme-muted)] leading-relaxed m-0">
                  保持相对资源目录结构引用，文件精巧轻量，可无缝部署至 GitHub Pages、Vercel
                  或个人静态博客。
                </p>
              </div>
            </div>
          )}

          {activeTab === "pdf" && (
            <div className="space-y-4 text-[12.5px] text-[var(--theme-text)]">
              {/* 分页防撕裂特性提示 */}
              <div className="flex items-center gap-2 rounded-[10px] border border-blue-500/20 bg-blue-500/[0.08] p-3 text-[11.5px] text-blue-800 dark:text-blue-300">
                <svg
                  className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>
                  已启用智能防截断引擎：表格、长代码块与公式行绝不跨页撕裂，矢量渲染保真。
                </span>
              </div>

              {/* 拟物分段控件组 */}
              <div className="space-y-3">
                {/* 纸张尺寸 */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--theme-muted)]">
                    纸张规格
                  </span>
                  <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setPageSize("A4")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        pageSize === "A4"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      A4 (210×297mm)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageSize("Letter")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        pageSize === "Letter"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      US Letter
                    </button>
                  </div>
                </div>

                {/* 页面方向 */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--theme-muted)]">
                    打印方向
                  </span>
                  <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setOrientation("portrait")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        orientation === "portrait"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      纵向 (Portrait)
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientation("landscape")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        orientation === "landscape"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      横向 (Landscape)
                    </button>
                  </div>
                </div>

                {/* 页边距 */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--theme-muted)]">
                    页面边距
                  </span>
                  <div className="inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setMargin("compact")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        margin === "compact"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      紧凑 (10mm)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMargin("standard")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        margin === "standard"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      标准 (15mm)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMargin("wide")}
                      className={`px-3 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                        margin === "wide"
                          ? "bg-white dark:bg-[#2c2e36] text-[var(--theme-title)] shadow-xs"
                          : "text-[var(--theme-muted)] hover:text-[var(--theme-title)]"
                      }`}
                    >
                      宽松 (25mm)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "copy" && (
            <div className="space-y-3.5 text-[12.5px] text-[var(--theme-text)]">
              <p className="leading-relaxed text-[var(--theme-muted)] text-[12px]">
                将 Markdown 实时编译为携带内联样式的语义富文本 HTML 并写入系统剪贴板：
              </p>
              <div className="rounded-[12px] border border-[var(--theme-border)] bg-[var(--theme-surface-soft)] p-3.5 space-y-2.5">
                <div className="text-[11.5px] font-medium text-[var(--theme-title)]">
                  跨平台多应用粘贴兼容：
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "飞书",
                    "语雀",
                    "微信公众号",
                    "Apple Mail",
                    "Outlook",
                    "Notion",
                    "企业微信",
                  ].map((app) => (
                    <span
                      key={app}
                      className="rounded-full bg-black/[0.04] dark:bg-white/[0.08] px-2.5 py-0.5 text-[11px] text-[var(--theme-text)] font-medium"
                    >
                      {app}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--theme-muted)] m-0 leading-relaxed">
                  直接 Command+V 粘贴即可完美继承多级标题、代码高亮、引用块、任务清单与表格。
                </p>
              </div>
            </div>
          )}

          {/* 分割线 */}
          <div className="my-5 border-b border-[var(--theme-border)]" />

          {/* 底部操作按钮栏 */}
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="rounded-[10px] border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-[12.5px] font-medium text-[var(--theme-text)] hover:bg-[var(--theme-hover)] transition-colors active:scale-[0.98]"
            >
              取消
            </button>

            {activeTab === "html" && (
              <button
                type="button"
                onClick={handleExportHtml}
                disabled={isExporting}
                className="flex items-center gap-1.5 rounded-[10px] bg-blue-600 hover:bg-blue-500 active:scale-[0.98] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all disabled:opacity-50"
              >
                {isExporting ? "正在导出..." : "选择目录并导出"}
              </button>
            )}

            {activeTab === "pdf" && (
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExporting}
                className="flex items-center gap-1.5 rounded-[10px] bg-blue-600 hover:bg-blue-500 active:scale-[0.98] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all disabled:opacity-50"
              >
                {isExporting ? "正在调起..." : "调起系统打印 / 另存为 PDF"}
              </button>
            )}

            {activeTab === "copy" && (
              <button
                type="button"
                onClick={handleCopyHtml}
                className="flex items-center gap-1.5 rounded-[10px] bg-blue-600 hover:bg-blue-500 active:scale-[0.98] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all"
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
