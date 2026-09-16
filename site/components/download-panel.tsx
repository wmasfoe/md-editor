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

function PlatformGlyph({ platform, className }: { platform: SitePlatform; className?: string }) {
  if (platform === "macos" || platform === "ios") {
    return (
      <svg viewBox="0 0 170 170" className={className} fill="currentColor" aria-hidden>
        <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.7-7.83-12-14.37-6.09-9.24-10.98-19.8-14.67-31.69-3.69-11.89-5.54-22.95-5.54-33.19 0-14.35 3.8-26.06 11.41-35.13 7.61-9.07 17.1-13.68 28.47-13.84 4.8 0 10.3 1.34 16.51 4.02 6.21 2.68 10.12 4.06 11.73 4.14 1.3.08 5.43-1.4 12.39-4.44 6.96-3.04 12.87-4.4 17.72-4.08 13.27.87 23.8 5.76 31.6 14.67-11.53 7.07-17.18 16.85-16.96 29.35.22 9.68 3.91 17.88 11.08 24.6 7.17 6.72 15.76 10.65 25.77 11.79-2.18 6.96-4.9 14.03-8.16 21.21zM119.22 33.5c0-7.39 2.65-14.24 7.95-20.55 5.3-6.31 11.74-10.33 19.32-12.05.65 3.04.98 5.76.98 8.16 0 7.28-2.72 14.24-8.16 20.88-5.44 6.64-12.07 10.59-19.89 11.85-.11-2.61-.2-5.38-.2-8.29z" />
      </svg>
    );
  }
  if (platform === "windows") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4h-13.051M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.949-1.801" />
      </svg>
    );
  }
  if (platform === "linux") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 9l3 3-3 3m5 0h3M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z"
        />
      </svg>
    );
  }
  if (platform === "android") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.996-3.4572c.1561-.2705.0635-.6159-.207-.772-.2715-.1561-.6158-.0636-.772.2069l-2.0253 3.5082a13.3 13.3 0 0 0-4.8732-.9168c-1.7487 0-3.4095.3347-4.8733.9168L5.1044 5.3088c-.1562-.2705-.5005-.363-772-.2069-.2705.1561-.3631.5015-.207.772l1.996 3.4572C2.868 11.233 1 14.3913 1 17.989h22c0-3.5977-1.868-6.756-5.1185-8.6676" />
      </svg>
    );
  }
  return null;
}

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
        <span className="rounded-full bg-line-strong/25 px-1.5 py-0.5 text-[9px] font-medium text-muted/75 leading-none">
          敬请期待
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
    return isEn ? "iOS (Coming Soon)" : "iOS（即将推出，暂未开放）";
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
  const [platform, setPlatform] = useState<SitePlatform>(
    initialPlatform === "ios" ? "macos" : initialPlatform,
  );
  const catalog = buildDownloadCatalog(version, locale);
  const current = catalog[platform];
  const install = getPlatformInstall(platform, locale);
  const platforms = listSitePlatforms();
  const isMobile = isMobilePlatform(platform);
  const mobileGuide = isMobile ? getMobilePlatformGuide(platform, locale) : null;

  return (
    <div className="w-full">
      {/* 平台切换：高通透液态玻璃轨道与物理水滴滑块 */}
      <div className="mx-auto mt-8 w-full max-w-md sm:mt-10 sm:max-w-xl">
        <LiquidGlassSegmentedControl
          items={platforms}
          value={platform}
          onChange={setPlatform}
          getLabel={renderPlatformLabel}
          getAriaLabel={(p) => getPlatformAriaLabel(p, locale === "en")}
          disabledItems={["ios"]}
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
            className="liquid-glass-button-dark group relative mt-4 inline-flex h-12 w-fit cursor-pointer items-center justify-center overflow-hidden rounded-full px-6 text-sm font-medium text-white sm:h-12 sm:px-7"
          >
            {/* 顶层液态镜面微光扫掠 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative z-10 inline-flex items-center gap-2.5 font-semibold tracking-tight">
              <PlatformGlyph platform={platform} className="h-4 w-4 shrink-0 opacity-90" />
              <span>{current.primary.label}</span>
              <svg
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-y-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
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
