"use client";

import { useState } from "react";
import {
  buildDownloadCatalog,
  getMobilePlatformGuide,
  getPlatformInstall,
  listSitePlatforms,
  type DownloadCatalog,
} from "../lib/downloads";
import { useI18n } from "../lib/i18n/context";
import { isMobilePlatform, SITE_PLATFORM_LABELS, type SitePlatform } from "../lib/platform";
import { InstallCommand } from "./install-command";
import { LiquidGlassSegmentedControl } from "./liquid-glass-segmented-control";

function renderPlatformLabel(platform: SitePlatform) {
  if (platform === "android") {
    return (
      <span className="inline-flex items-center gap-1 sm:gap-1.5">
        <span>Android</span>
        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent leading-none">
          Beta
        </span>
      </span>
    );
  }
  if (platform === "ios") {
    return (
      <span className="inline-flex items-center gap-1 sm:gap-1.5">
        <span>iOS</span>
        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent leading-none">
          Beta
        </span>
      </span>
    );
  }
  return SITE_PLATFORM_LABELS[platform];
}

function getPlatformAriaLabel(platform: SitePlatform, isEn: boolean): string {
  if (platform === "android") {
    return isEn ? "Android (Beta)" : "Android（测试版）";
  }
  if (platform === "ios") {
    return isEn ? "iOS (Beta)" : "iOS（测试版）";
  }
  return SITE_PLATFORM_LABELS[platform];
}

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
  const isMobile = isMobilePlatform(platform);
  const mobileGuide = isMobile ? getMobilePlatformGuide(platform, locale) : null;

  return (
    <div className="w-full">
      {/* 平台切换与单一主按钮：支持鼠标拖拽滑块与白底延迟吸附 */}
      <div className="mx-auto mt-8 w-full max-w-md sm:mt-10 sm:max-w-xl">
        <LiquidGlassSegmentedControl
          items={platforms}
          value={platform}
          onChange={setPlatform}
          getLabel={renderPlatformLabel}
          getAriaLabel={(p) => getPlatformAriaLabel(p, locale === "en")}
          ariaLabel={t.download.tablistAria}
        />

        <div
          id="download-panel"
          role="tabpanel"
          aria-labelledby={`download-tab-${platform}`}
          className="flex justify-center"
        >
          <a
            href={current.primary.href}
            download={current.primary.fileName}
            target={platform === "ios" ? "_blank" : undefined}
            rel={platform === "ios" ? "noreferrer" : undefined}
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
        {current.isBeta ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            <span>{locale === "en" ? "Public Beta" : "测试版状态"}</span>
          </span>
        ) : null}
        {current.isBeta ? <span className="text-line-strong">·</span> : null}
        {current.version || version ? (
          <span>
            {t.hero.latestPrefix} v{current.version ?? version}
          </span>
        ) : null}
        {current.version || version ? <span className="text-line-strong">·</span> : null}
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

      {/* 桌面端命令行一键安装 或 移动端测试版说明指南卡片 */}
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
      ) : mobileGuide ? (
        <div className="mx-auto mt-8 max-w-2xl text-left sm:mt-10">
          <div className="relative overflow-hidden rounded-2xl border border-line-strong/80 bg-surface/75 p-5 shadow-xs backdrop-blur-md sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3 sm:pb-4">
              <span className="text-base font-semibold text-ink sm:text-lg">
                {mobileGuide.title}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {mobileGuide.badge}
              </span>
            </div>

            <div className="mt-4 space-y-3 text-xs leading-relaxed text-muted sm:text-sm">
              <p className="text-ink-soft">
                <strong className="text-ink">{locale === "en" ? "System: " : "系统要求："}</strong>
                {mobileGuide.requirements}
              </p>
              <p>{mobileGuide.description}</p>
              <div className="rounded-xl border border-line/70 bg-surface-raised/50 p-3 text-ink-soft">
                <span className="font-medium text-ink">
                  {locale === "en" ? "Installation Tip: " : "安装提示："}
                </span>
                {mobileGuide.tips}
              </div>
              <p className="text-[11px] text-muted sm:text-xs">
                {mobileGuide.feedback}{" "}
                <a
                  href="https://github.com/wmasfoe/md-editor/issues"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ink underline decoration-line-strong hover:text-accent"
                >
                  GitHub Issues →
                </a>
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
