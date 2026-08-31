"use client";

import { useState } from "react";
import {
  buildDownloadCatalog,
  getPlatformInstall,
  listSitePlatforms,
  type DownloadCatalog,
} from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { SITE_PLATFORM_LABELS, type SitePlatform } from "../lib/platform";
import { InstallCommand } from "./install-command";
import { LiquidGlassSegmentedControl } from "./liquid-glass-segmented-control";

type DownloadPanelProps = {
  catalog?: DownloadCatalog;
  initialPlatform: SitePlatform;
  version?: string;
};

export function DownloadPanel({ initialPlatform, version }: DownloadPanelProps) {
  const { locale, t } = useI18n();
  const [platform, setPlatform] = useState<SitePlatform>(initialPlatform);
  const catalog = buildDownloadCatalog(version, locale);
  const current = catalog[platform];
  const install = getPlatformInstall(platform, locale);
  const platforms = listSitePlatforms();

  return (
    <div id="download">
      {/* 平台切换与单一主按钮：支持鼠标拖拽滑块与白底延迟吸附 */}
      <div className="mx-auto mt-8 w-full max-w-sm sm:mt-10">
        <LiquidGlassSegmentedControl
          items={platforms}
          value={platform}
          onChange={setPlatform}
          getLabel={(p) => SITE_PLATFORM_LABELS[p]}
          ariaLabel={t.download.tablistAria}
        />

        <div id="download-panel" role="tabpanel" aria-labelledby={`download-tab-${platform}`}>
          <a
            href={current.primary.href}
            download={current.primary.fileName}
            aria-label={`${current.primary.label}，${current.format}`}
            className="liquid-glass-button-dark group relative mt-3.5 inline-flex h-12 w-fit cursor-pointer items-center justify-center overflow-hidden rounded-full px-6 text-sm font-medium text-white sm:h-12"
          >
            {/* 顶层液态镜面微光扫掠 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative z-10 font-semibold tracking-tight">
              {current.primary.label}
            </span>
          </a>
        </div>
      </div>

      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-muted">
        {version ? (
          <span>
            {t.hero.latestPrefix} v{version}
          </span>
        ) : null}
        {version ? <span className="text-line-strong">·</span> : null}
        <span>{current.format}</span>
        {current.secondary.map((asset) => (
          <span key={asset.href} className="inline-flex items-center gap-x-2.5">
            <span className="text-line-strong">·</span>
            <a
              href={asset.href}
              download={asset.fileName}
              className="text-ink-soft transition-colors hover:text-ink"
            >
              {asset.label}
            </a>
          </span>
        ))}
        <span className="text-line-strong">·</span>
        <a
          href={catalog.allPackagesUrl}
          target="_blank"
          rel="noreferrer"
          className="text-ink-soft transition-colors hover:text-ink"
        >
          {t.hero.allPackages}
        </a>
      </p>

      <div className="mx-auto mt-8 max-w-2xl text-left sm:mt-10">
        <InstallCommand
          key={`${platform}-${locale}`}
          title={install.title}
          command={install.command}
          recommended={install.recommended}
          extra={install.extra}
        />
      </div>
    </div>
  );
}
