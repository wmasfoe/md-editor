"use client";

import { useState, type KeyboardEvent } from "react";
import {
  buildDownloadCatalog,
  getPlatformInstall,
  listSitePlatforms,
  type DownloadCatalog,
} from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { SITE_PLATFORM_LABELS, type SitePlatform } from "../lib/platform";
import { InstallCommand } from "./install-command";

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

  function handleSwitcherKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const index = platforms.indexOf(platform);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = platforms[(index + delta + platforms.length) % platforms.length];
    setPlatform(next);
    const tab = event.currentTarget.querySelector<HTMLButtonElement>(`[data-platform="${next}"]`);
    tab?.focus();
  }

  return (
    <div id="download">
      {/* 平台切换与单一主按钮：避免三套安装包并排撑开 hero。 */}
      <div className="mx-auto mt-8 w-full max-w-sm sm:mt-10">
        <div
          role="tablist"
          aria-label={t.download.tablistAria}
          onKeyDown={handleSwitcherKeyDown}
          className="grid grid-cols-3 rounded-full border border-line bg-surface-soft p-1"
        >
          {platforms.map((item) => {
            const selected = item === platform;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                id={`download-tab-${item}`}
                data-platform={item}
                aria-selected={selected}
                aria-controls="download-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setPlatform(item)}
                className={[
                  "inline-flex h-9 items-center justify-center rounded-full text-[13px] font-medium transition-colors sm:text-sm",
                  selected
                    ? "bg-surface text-ink shadow-[0_1px_0_rgb(0_0_0_/0.04)]"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {SITE_PLATFORM_LABELS[item]}
              </button>
            );
          })}
        </div>

        <div id="download-panel" role="tabpanel" aria-labelledby={`download-tab-${platform}`}>
          <a
            href={current.primary.href}
            download={current.primary.fileName}
            aria-label={`${current.primary.label}，${current.format}`}
            className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-full bg-ink px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 sm:h-11"
          >
            {current.primary.label}
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
