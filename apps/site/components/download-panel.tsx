"use client";

import Link from "next/link";
import { FaAndroid, FaApple, FaLinux, FaWindows } from "react-icons/fa6";
import { useState } from "react";
import {
  buildDownloadCatalog,
  getPlatformInstall,
  listSitePlatforms,
  type DownloadCatalog,
} from "../lib/downloads";
import { useDistribution } from "../lib/distribution/context";
import { useI18n } from "../lib/i18n/context";
import { ANDROID_SOURCE_GUIDE_URL, IOS_SOURCE_GUIDE_URL } from "../lib/site-links";
import { isMobilePlatform, SITE_PLATFORM_LABELS, type SitePlatform } from "../lib/platform";
import { InstallCommand } from "./install-command";
import { LiquidGlassSegmentedControl } from "./liquid-glass-segmented-control";

function PlatformGlyph({ platform, className }: { platform: SitePlatform; className?: string }) {
  if (platform === "macos" || platform === "ios") {
    return <FaApple className={className} aria-hidden />;
  }
  if (platform === "windows") {
    return <FaWindows className={className} aria-hidden />;
  }
  if (platform === "linux") {
    return <FaLinux className={className} aria-hidden />;
  }
  if (platform === "android") {
    return <FaAndroid className={className} aria-hidden />;
  }
  return null;
}

function renderPlatformLabel(platform: SitePlatform) {
  if (platform === "windows") {
    return (
      <span className="text-[12px] sm:text-sm">
        <span className="sm:hidden">Win</span>
        <span className="hidden sm:inline">Windows</span>
      </span>
    );
  }
  return <span className="text-[12px] sm:text-sm">{SITE_PLATFORM_LABELS[platform]}</span>;
}

type DownloadPanelProps = {
  catalog?: DownloadCatalog;
  initialPlatform: SitePlatform;
  version?: string;
};

export function DownloadPanel({ initialPlatform, version }: DownloadPanelProps) {
  const { locale, t } = useI18n();
  const { domain } = useDistribution();
  const [platform, setPlatform] = useState<SitePlatform>(initialPlatform);
  const catalog = buildDownloadCatalog(version, locale, domain);
  const current = catalog[platform];
  const install = getPlatformInstall(platform, locale);
  const platforms = listSitePlatforms();
  const isMobile = isMobilePlatform(platform);

  return (
    <div className="w-full">
      {/* 平台切换：高通透液态玻璃轨道与物理水滴滑块 */}
      <div className="mx-auto mt-8 w-full max-w-md sm:mt-10 sm:max-w-xl">
        <LiquidGlassSegmentedControl
          items={platforms}
          value={platform}
          onChange={setPlatform}
          getLabel={(p) => renderPlatformLabel(p)}
          getAriaLabel={(p) => SITE_PLATFORM_LABELS[p]}
          ariaLabel={t.download.tablistAria}
        />

        <div
          id="download-panel"
          role="tabpanel"
          aria-labelledby={`download-tab-${platform}`}
          className="flex justify-center px-2"
        >
          <a
            href={current.primary.href}
            download={current.primary.fileName}
            aria-label={`${current.primary.label}，${current.format}`}
            className="liquid-glass-button-dark group relative mt-4 inline-flex h-12 w-full max-w-xs cursor-pointer items-center justify-center overflow-hidden rounded-full px-5 text-sm font-medium text-white sm:h-12 sm:w-fit sm:px-7"
          >
            {/* 顶层液态镜面微光扫掠 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative z-10 inline-flex items-center gap-2.5 font-medium tracking-tight">
              <PlatformGlyph platform={platform} className="h-4 w-4 shrink-0 opacity-90" />
              <span>{current.primary.label}</span>
            </span>
          </a>
        </div>
      </div>

      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-3 text-center text-xs text-muted sm:gap-x-2.5 sm:text-sm">
        {current.isBeta ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span>{t.download.betaStatus}</span>
          </span>
        ) : null}
        {current.isBeta ? <span className="text-line-strong">·</span> : null}
        {current.version || version ? (
          isMobile ? (
            <span>v{current.version}</span>
          ) : (
            <Link
              href="/changelog#desktop"
              className="transition-colors hover:text-ink hover:underline"
              title={t.header.changelog}
            >
              {t.hero.latestPrefix} v{current.version ?? version}
            </Link>
          )
        ) : null}
        {current.version || version ? <span className="text-line-strong">·</span> : null}
        <span>{current.format}</span>
        {current.secondary.map((asset) => (
          <span key={asset.href} className="inline-flex items-center gap-x-2 sm:gap-x-2.5">
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
        {!isMobile ? (
          <>
            <span className="text-line-strong">·</span>
            <a
              href={catalog.desktopPackagesUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink-soft transition-colors hover:text-ink"
            >
              {t.hero.allPackages}
            </a>
          </>
        ) : null}
      </p>

      {/* 桌面端命令行一键安装；移动端只提示后续版本需要自行编译 */}
      {install ? (
        <div className="mx-auto mt-8 max-w-2xl text-left sm:mt-10">
          <InstallCommand
            key={`${platform}-${locale}`}
            title={install.title}
            command={install.command}
            recommended={install.recommended}
            extra={install.extra}
          />
        </div>
      ) : (
        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-muted sm:mt-10 sm:text-sm">
          {t.download.mobileBuildHint.replace("{version}", current.version ?? "")}{" "}
          <a
            href={platform === "ios" ? IOS_SOURCE_GUIDE_URL : ANDROID_SOURCE_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink-soft underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
          >
            {t.download.mobileBuildGuide}
          </a>
        </p>
      )}
    </div>
  );
}
