"use client";

import { StarIcon } from "@heroicons/react/20/solid";
import { useState } from "react";

type InstallCommandProps = {
  /** 终端命令正文 */
  command: string;
  /** 卡片标题，默认「终端安装 · macOS」 */
  title?: string;
  /** 标题下方的简短说明（可选） */
  description?: string;
  /** 标记为推荐安装方式（标题旁显示星星） */
  recommended?: boolean;
};

export function InstallCommand({
  command,
  title = "终端安装 · macOS",
  description,
  recommended = false,
}: InstallCommandProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败，命令仍可手动选择复制。
    }
  }

  return (
    <div className="site-panel overflow-hidden rounded-2xl">
      <div className="site-panel-bar flex items-start justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommended ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/15 px-2 py-0.5 text-[11px] font-medium tracking-wide text-accent"
                title="推荐安装方式"
              >
                <StarIcon aria-hidden className="h-3 w-3" />
                推荐
              </span>
            ) : null}
            <span className="text-xs font-medium tracking-wide text-muted">{title}</span>
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted/90">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-white/20 bg-white/10 px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-white/18 hover:text-ink sm:min-h-0 sm:py-1"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {/* 窄屏优先换行可读，避免整段命令只能横滑；桌面仍保持单行滚动风格 */}
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-soft sm:p-4 sm:text-sm sm:break-normal sm:whitespace-pre">
        <code>{command}</code>
      </pre>
    </div>
  );
}
