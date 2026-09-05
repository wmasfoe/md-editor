// apps/utools/src/components/CompactHeader.tsx
// 紧凑型顶部操作栏：模式切换、状态提示与核心操作入口

import type { EditorMode } from "../utools/types";
import { openOfficialSite } from "../utools/referral";

export interface CompactHeaderProps {
  mode: EditorMode;
  filePath: string | null;
  onSwitchToScratchpad: () => void;
  onOpenFile: () => void;
  onPasteBackToApp: () => void;
  onCopyAll: () => void;
}

export function CompactHeader({
  mode,
  filePath,
  onSwitchToScratchpad,
  onOpenFile,
  onPasteBackToApp,
  onCopyAll,
}: CompactHeaderProps) {
  const fileName = filePath ? (filePath.split(/[/\\]/).pop() ?? "本地文件") : "未命名草稿";

  return (
    <header className="flex items-center justify-between px-3 py-2 bg-[var(--theme-chrome)] border-b border-[var(--theme-border)] shrink-0 select-none">
      {/* 左侧：Logo、标题与模式指示 */}
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm tracking-tight text-[var(--theme-title)] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--theme-primary)] inline-block"></span>
          Inkpoint
        </span>

        <div className="flex items-center bg-[var(--theme-control-active)] rounded p-0.5 text-xs">
          <button
            type="button"
            onClick={onSwitchToScratchpad}
            className={`px-2 py-0.5 rounded cursor-pointer border-0 transition-colors ${
              mode === "scratchpad"
                ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-medium shadow-xs"
                : "bg-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            }`}
          >
            草稿 (同步)
          </button>
          <button
            type="button"
            onClick={onOpenFile}
            className={`px-2 py-0.5 rounded cursor-pointer border-0 transition-colors ${
              mode === "file"
                ? "bg-[var(--theme-surface)] text-[var(--theme-title)] font-medium shadow-xs"
                : "bg-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            }`}
            title={filePath ?? "打开本地 Markdown 文件"}
          >
            {mode === "file" ? fileName : "打开文件"}
          </button>
        </div>
      </div>

      {/* 右侧：快捷操作按钮 */}
      <div className="flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={onCopyAll}
          className="px-2 py-1 rounded bg-[var(--theme-control-active)] hover:bg-[var(--theme-control-hover)] text-[var(--theme-text)] cursor-pointer border border-[var(--theme-border)]"
          title="复制全文 Markdown 到剪贴板"
        >
          复制
        </button>

        {typeof window !== "undefined" && typeof window.utools !== "undefined" && (
          <button
            type="button"
            onClick={onPasteBackToApp}
            className="px-2 py-1 rounded bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary-selected)] font-medium cursor-pointer border border-[var(--theme-primary-soft)]"
            title="隐藏 uTools 窗口并直接粘贴至刚才活动的软件"
          >
            贴回应用
          </button>
        )}

        <button
          type="button"
          onClick={() => openOfficialSite("compact_header")}
          className="px-2 py-1 rounded text-[var(--theme-muted)] hover:text-[var(--theme-primary)] hover:underline cursor-pointer bg-transparent border-0"
          title="前往官网了解更多完整桌面功能"
        >
          官网 ↗
        </button>
      </div>
    </header>
  );
}
