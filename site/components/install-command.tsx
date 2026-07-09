"use client";

import { useState } from "react";

type InstallCommandProps = {
  command: string;
};

export function InstallCommand({ command }: InstallCommandProps) {
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
      <div className="flex items-center justify-between border-b border-line bg-surface-soft/70 px-4 py-2.5">
        <span className="text-xs font-medium tracking-wide text-muted">终端安装 · macOS</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-white hover:text-ink"
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
