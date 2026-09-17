"use client";

import Link from "next/link";
import { useState } from "react";
import { useDistribution } from "../lib/distribution/context";
import { useI18n } from "../lib/i18n/context";
import {
  formatDownloadUrlWithDomain,
  type ReleaseAsset,
  type ReleasesData,
  type VersionRelease,
} from "../lib/releases-types";

interface ReleasesContentProps {
  initialData: ReleasesData;
}

type DeviceFilter = "all" | "desktop" | "android";

export function ReleasesContent({ initialData }: ReleasesContentProps) {
  const { t } = useI18n();
  const { domain } = useDistribution();
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("all");

  const desktopReleases = initialData.releases.filter((r) => r.category === "desktop");
  const androidReleases = initialData.releases.filter((r) => r.category === "android");

  const filteredReleases = initialData.releases.filter((r) => {
    if (deviceFilter === "desktop") return r.category === "desktop";
    if (deviceFilter === "android") return r.category === "android";
    return true;
  });

  const latestDesktop = desktopReleases[0];
  const latestAndroid = androidReleases[0];

  function getPlatformAssetLabel(asset: ReleaseAsset): string {
    const p = asset.platform.toLowerCase();
    if (p.includes("arm64") || p.includes("aarch64")) {
      return t.releases.macArm;
    }
    if (p.includes("x64") && p.includes("macos")) {
      return t.releases.macIntel;
    }
    if (p.includes("win")) {
      return t.releases.windows;
    }
    if (p.includes("appimage")) {
      return t.releases.linuxAppImage;
    }
    if (p.includes("deb")) {
      return t.releases.linuxDeb;
    }
    if (p.includes("android") || p.includes("apk")) {
      return t.releases.androidApk;
    }
    return asset.platformLabel || asset.fileName;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-16">
      {/* 面包屑导航与返回首页 */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex items-center justify-between gap-3 text-xs sm:text-sm"
      >
        <ol className="flex items-center gap-2 text-muted">
          <li>
            <Link href="/" className="transition-colors hover:text-ink">
              {t.releases.breadcrumbRoot}
            </Link>
          </li>
          <li aria-hidden="true" className="text-line-strong">
            /
          </li>
          <li aria-current="page" className="font-medium text-ink">
            {t.releases.breadcrumbApp}
          </li>
        </ol>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition-colors hover:text-ink sm:text-sm"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>{t.releases.backHome}</span>
        </Link>
      </nav>

      {/* 页面主标题区 */}
      <header className="mb-10 border-b border-line pb-8 sm:mb-12">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-md border border-line-strong bg-surface-soft px-2 py-0.5 text-xs font-medium tracking-wide uppercase text-accent">
            Edge Distributed
          </span>
          <span className="text-xs text-muted">
            Host: <span className="font-mono text-ink-soft">{domain}</span>
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl lg:text-4xl">
          {t.releases.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
          {t.releases.subtitle}
        </p>
      </header>

      {/* 模块一：设备类型索引表（严格按设备类型第一列划分） */}
      <section className="mb-14" aria-labelledby="device-directory-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="device-directory-heading" className="text-lg font-semibold text-ink sm:text-xl">
            {t.releases.overviewTitle}
          </h2>
          <a
            href="#all-releases"
            className="text-xs font-medium text-accent transition-colors hover:underline sm:text-sm"
          >
            {t.releases.viewHistory} &darr;
          </a>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <caption className="sr-only">{t.releases.overviewTitle}</caption>
              <thead>
                <tr className="border-b border-line bg-surface-soft text-muted font-medium">
                  <th scope="col" className="px-4 py-3.5 sm:px-6 w-[22%]">
                    {t.releases.colDevice}
                  </th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6 w-[18%]">
                    {t.releases.colLatest}
                  </th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6 w-[35%]">
                    {t.releases.colCoverage}
                  </th>
                  <th scope="col" className="px-4 py-3.5 sm:px-6 w-[25%]">
                    {t.releases.colAction}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-normal">
                {/* 1. Desktop 桌面端 */}
                <tr className="transition-colors hover:bg-surface-soft/40">
                  <td className="px-4 py-4 sm:px-6 font-medium text-ink">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-ink text-sm sm:text-base">
                        {t.releases.deviceDesktop}
                      </span>
                      <span className="text-[11px] text-muted tracking-wide uppercase">
                        macOS · Windows · Linux
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <div className="inline-flex items-center gap-2">
                      <span className="font-mono font-medium text-ink">
                        v{initialData.latestDesktopVersion}
                      </span>
                      <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                        {t.releases.latestBadge}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 sm:px-6 text-muted leading-relaxed">
                    {t.releases.deviceDesktopCoverage}
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-2">
                      {latestDesktop && (
                        <div className="flex flex-wrap gap-1.5">
                          {latestDesktop.assets.map((asset) => {
                            const assetUrl = formatDownloadUrlWithDomain(asset.downloadUrl, domain);
                            const label = getPlatformAssetLabel(asset);
                            return (
                              <a
                                key={asset.fileName}
                                href={assetUrl}
                                download={asset.fileName}
                                className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink transition-all hover:border-accent hover:text-accent hover:shadow-xs"
                                title={`${asset.fileName} (${asset.formattedSize || ""})`}
                              >
                                <svg
                                  className="h-3 w-3 text-muted"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                  />
                                </svg>
                                <span>{label}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                      <a
                        href="#desktop-releases"
                        onClick={() => setDeviceFilter("desktop")}
                        className="text-xs text-muted transition-colors hover:text-ink hover:underline"
                      >
                        {t.releases.viewHistory}
                      </a>
                    </div>
                  </td>
                </tr>

                {/* 2. Android 移动端 */}
                <tr className="transition-colors hover:bg-surface-soft/40">
                  <td className="px-4 py-4 sm:px-6 font-medium text-ink">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-ink text-sm sm:text-base">
                        {t.releases.deviceAndroid}
                      </span>
                      <span className="text-[11px] text-muted tracking-wide uppercase">
                        Android APK
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <div className="inline-flex items-center gap-2">
                      <span className="font-mono font-medium text-ink">
                        v{initialData.latestAndroidVersion}
                      </span>
                      <span className="rounded bg-sky-600/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                        {t.releases.betaBadge}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 sm:px-6 text-muted leading-relaxed">
                    {t.releases.deviceAndroidCoverage}
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-2">
                      {latestAndroid?.assets?.[0] ? (
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={formatDownloadUrlWithDomain(
                              latestAndroid.assets[0].downloadUrl,
                              domain,
                            )}
                            download={latestAndroid.assets[0].fileName}
                            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink transition-all hover:border-accent hover:text-accent hover:shadow-xs"
                          >
                            <svg
                              className="h-3 w-3 text-muted"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                            <span>{t.releases.androidApk}</span>
                            {latestAndroid.assets[0].formattedSize && (
                              <span className="text-[11px] text-muted">
                                ({latestAndroid.assets[0].formattedSize})
                              </span>
                            )}
                          </a>
                        </div>
                      ) : null}
                      <a
                        href="#android-releases"
                        onClick={() => setDeviceFilter("android")}
                        className="text-xs text-muted transition-colors hover:text-ink hover:underline"
                      >
                        {t.releases.viewHistory}
                      </a>
                    </div>
                  </td>
                </tr>

                {/* 3. iOS 移动端 */}
                <tr className="transition-colors hover:bg-surface-soft/40">
                  <td className="px-4 py-4 sm:px-6 font-medium text-ink">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-ink text-sm sm:text-base">
                        {t.releases.deviceIos}
                      </span>
                      <span className="text-[11px] text-muted tracking-wide uppercase">
                        iPhone · iPad
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <span className="inline-flex rounded bg-surface-soft px-2 py-0.5 text-xs font-medium text-muted">
                      {t.releases.iosStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4 sm:px-6 text-muted leading-relaxed">
                    {t.releases.deviceIosCoverage}
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <span className="text-xs leading-relaxed text-muted">
                      {t.releases.iosNotice}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 模块二：全量版本与安装包归档（All Releases） */}
      <section id="all-releases" aria-labelledby="all-releases-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="all-releases-heading" className="text-lg font-semibold text-ink sm:text-xl">
              {t.releases.allVersions}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Total {filteredReleases.length} release entries
            </p>
          </div>

          {/* 筛选控制器 */}
          <div
            role="group"
            aria-label="Device category filter"
            className="inline-flex rounded-lg border border-line bg-surface-soft p-1 self-start sm:self-auto"
          >
            <button
              type="button"
              onClick={() => setDeviceFilter("all")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                deviceFilter === "all"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.releases.allVersions}
            </button>
            <button
              type="button"
              onClick={() => setDeviceFilter("desktop")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                deviceFilter === "desktop"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.releases.deviceDesktop}
            </button>
            <button
              type="button"
              onClick={() => setDeviceFilter("android")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                deviceFilter === "android"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.releases.deviceAndroid}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <caption className="sr-only">{t.releases.allVersions}</caption>
              <thead>
                <tr className="border-b border-line bg-surface-soft text-muted font-medium">
                  <th scope="col" className="px-4 py-3 sm:px-5 w-[16%]">
                    {t.releases.colDevice}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-5 w-[14%]">
                    {t.releases.colVersion}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-5 w-[16%]">
                    {t.releases.colDate}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-5 w-[42%]">
                    {t.releases.colPackages}
                  </th>
                  <th scope="col" className="px-4 py-3 sm:px-5 w-[12%] text-right">
                    {t.releases.viewNotes}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-normal">
                {filteredReleases.map((release: VersionRelease) => {
                  const isDesktop = release.category === "desktop";
                  const releaseDate = release.publishedAt.split("T")[0];
                  return (
                    <tr
                      key={`${release.category}-${release.version}`}
                      id={`v${release.version}`}
                      className="transition-colors hover:bg-surface-soft/40"
                    >
                      {/* 1. 设备类型 */}
                      <td className="px-4 py-3.5 sm:px-5 font-medium text-ink align-top">
                        <span className="inline-flex items-center rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-ink-soft">
                          {isDesktop ? t.releases.deviceDesktop : t.releases.deviceAndroid}
                        </span>
                      </td>

                      {/* 2. 版本号 */}
                      <td className="px-4 py-3.5 sm:px-5 align-top">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono font-semibold text-ink">
                            v{release.version}
                          </span>
                          {release.isLatest && (
                            <span className="self-start rounded bg-emerald-600/10 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700">
                              {t.releases.latestBadge}
                            </span>
                          )}
                          {release.isPrerelease && !release.isLatest && (
                            <span className="self-start rounded bg-sky-600/10 px-1.5 py-0.2 text-[10px] font-medium text-sky-700">
                              {t.releases.betaBadge}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. 发布日期 */}
                      <td className="px-4 py-3.5 sm:px-5 text-muted align-top whitespace-nowrap font-mono text-xs">
                        {releaseDate}
                      </td>

                      {/* 4. 安装包列表（直连 R2） */}
                      <td className="px-4 py-3.5 sm:px-5 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {release.assets
                            .filter((a) => a.platform !== "updater")
                            .map((asset) => {
                              const assetUrl = formatDownloadUrlWithDomain(
                                asset.downloadUrl,
                                domain,
                              );
                              const label = getPlatformAssetLabel(asset);
                              return (
                                <a
                                  key={asset.fileName}
                                  href={assetUrl}
                                  download={asset.fileName}
                                  className="inline-flex items-center gap-1.5 rounded border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink-soft transition-all hover:border-accent hover:text-ink hover:shadow-2xs"
                                  title={`${asset.fileName} · ${asset.formattedSize || "R2 Direct"}`}
                                >
                                  <svg
                                    className="h-3 w-3 text-muted shrink-0"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                    />
                                  </svg>
                                  <span>{label}</span>
                                  {asset.formattedSize && (
                                    <span className="font-mono text-[10px] text-muted">
                                      {asset.formattedSize}
                                    </span>
                                  )}
                                </a>
                              );
                            })}
                        </div>
                      </td>

                      {/* 5. 更新说明 */}
                      <td className="px-4 py-3.5 sm:px-5 align-top text-right whitespace-nowrap">
                        {release.releaseNotesUrl ? (
                          <a
                            href={release.releaseNotesUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:underline"
                          >
                            <span>{t.releases.viewNotes}</span>
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        ) : (
                          <Link
                            href={`/changelog#v${release.version}`}
                            className="text-xs text-muted transition-colors hover:text-ink hover:underline"
                          >
                            Changelog
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
