"use client";

import { useEffect, useState } from "react";
import { getPrimaryDownload, type DownloadCatalog } from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { detectSitePlatform, type SitePlatform } from "../lib/platform";

type HeaderDownloadButtonProps = {
  catalog: DownloadCatalog;
};

/** 页头「下载」保持单按钮；按 UA 指向当前平台主安装包，避免永远链到 macOS。 */
export function HeaderDownloadButton({ catalog }: HeaderDownloadButtonProps) {
  const [platform, setPlatform] = useState<SitePlatform>("macos");
  const { t } = useI18n();

  useEffect(() => {
    setPlatform(detectSitePlatform(navigator.userAgent));
  }, []);

  const asset = getPrimaryDownload(catalog, platform);

  return (
    <a
      href={asset.href}
      // 跨域时 download 属性可能被浏览器忽略；GitHub asset 仍会以 attachment 触发下载。
      download={asset.fileName}
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
