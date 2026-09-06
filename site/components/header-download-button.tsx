"use client";

import type { DownloadCatalog } from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";

type HeaderDownloadButtonProps = {
  catalog: DownloadCatalog;
};

/** 页头「下载」作为全局快捷跳转，平滑滚动至页面底部的专属下载大厅 */
export function HeaderDownloadButton({ catalog: _catalog }: HeaderDownloadButtonProps) {
  const { t } = useI18n();

  return (
    <a
      href="#download"
      className="liquid-glass-button-dark group relative ml-0.5 inline-flex min-h-9 cursor-pointer items-center justify-center overflow-hidden rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white sm:ml-1 sm:min-h-0 sm:px-4 sm:text-sm"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
      />
      <span className="relative z-10 font-semibold tracking-tight">{t.header.download}</span>
    </a>
  );
}
