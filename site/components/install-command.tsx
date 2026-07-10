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
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgb(0_0_0_/0.02)]">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-soft/70 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommended ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-accent"
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
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-white hover:text-ink"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-ink-soft sm:text-sm">
        <code>{command}</code>
      </pre>
    </div>
  );
}
