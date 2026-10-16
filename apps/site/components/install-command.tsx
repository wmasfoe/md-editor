"use client";

import { StarIcon } from "@heroicons/react/20/solid";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n/context";

type ExtraCommand = {
  title: string;
  command: string;
};

type InstallCommandProps = {
  /** 终端命令正文 */
  command: string;
  /** 卡片标题，默认「终端安装 · macOS」 */
  title?: string;
  /** 标题下方的简短说明（可选） */
  description?: string;
  /** 标记为推荐安装方式（标题旁显示星星） */
  recommended?: boolean;
  /** 折叠的次要命令，例如 macOS 移除隔离标记 */
  extra?: ExtraCommand;
};

export function InstallCommand({
  command,
  title = "终端安装 · macOS",
  description,
  recommended = false,
  extra,
}: InstallCommandProps) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgb(0_0_0_/0.02)]">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-soft/70 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {recommended ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-accent"
                title={t.download.recommendedTag}
              >
                <StarIcon aria-hidden className="h-3 w-3" />
                {t.download.recommendedTag}
              </span>
            ) : null}
            <span className="text-xs font-medium tracking-wide text-muted">{title}</span>
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted/90">{description}</p>
          ) : null}
        </div>
        <CopyButton value={command} />
      </div>
      {/* 窄屏优先换行可读，避免整段命令只能横滑；桌面仍保持单行滚动风格 */}
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-soft sm:p-4 sm:text-sm sm:break-normal sm:whitespace-pre">
        <code>{command}</code>
      </pre>
      {extra ? (
        <div className="group border-t border-line bg-surface-soft/40">
          <div className="flex min-h-10 cursor-pointer list-none items-center px-3 text-xs font-medium text-muted transition-colors hover:text-ink sm:px-4 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="mr-1.5 inline-block text-[10px] text-line-strong transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            {extra.title}
          </div>
          <div className="flex items-start justify-between gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
            <pre className="min-w-0 flex-1 overflow-x-auto text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-soft sm:text-sm sm:break-normal sm:whitespace-pre">
              <code>{extra.command}</code>
            </pre>
            <CopyButton value={extra.command} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    setCopied(false);
  }, [value]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // 剪贴板不可用时静默失败，命令仍可手动选择复制。
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t.download.copiedButton : t.download.copyButton}
      className="liquid-glass-button-light inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-ink-soft sm:min-h-0 sm:py-1"
    >
      {copied ? t.download.copiedButton : t.download.copyButton}
    </button>
  );
}
