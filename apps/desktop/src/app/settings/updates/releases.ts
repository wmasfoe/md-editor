/**
 * @fileoverview GitHub Releases 解析与语义化版本比较 (Releases Parser)
 */

import { isWindowsPlatform } from "../../../lib/keyboard";
import {
  DEFAULT_UPDATE_SETTINGS,
  INSTALL_WITH_CURL_COMMAND,
  INSTALL_WITH_POWERSHELL_COMMAND,
  UPDATE_RELEASES_API_URL,
} from "./defaults.ts";
import type { AppUpdateSettings, UpdateStatus } from "./types.ts";

declare const __APP_VERSION__: string;

interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

interface PublishedRelease {
  readonly version: string;
  readonly releaseUrl?: string;
  readonly downloadUrl?: string;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function readString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

/**
 * 获取当前编译嵌入的客户端版本号
 */
export function appVersion(): string {
  return __APP_VERSION__;
}

/**
 * 比较两个语义化版本号
 *
 * @returns 1 if left > right, -1 if left < right, 0 if equal
 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);

  if (!leftVersion || !rightVersion) {
    const fallback = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    return fallback === 0 ? 0 : fallback > 0 ? 1 : -1;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }

  if (leftVersion.prerelease === rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

/**
 * 从 GitHub API 返回的发布列表中构建更新状态对象
 */
export function createUpdateStatusFromGitHubReleases(
  currentVersion: string,
  payload: unknown,
): UpdateStatus {
  const latestRelease = findLatestMdEditorRelease(payload);
  if (!latestRelease) {
    return {
      currentVersion,
      state: "unconfigured",
    };
  }

  const comparison = compareReleaseVersions(latestRelease.version, currentVersion);
  if (comparison > 0) {
    return {
      currentVersion,
      state: "available",
      latestVersion: latestRelease.version,
      releaseUrl: latestRelease.releaseUrl,
      downloadUrl: latestRelease.downloadUrl,
      installKind: "manual",
      installCommand: isWindowsPlatform()
        ? INSTALL_WITH_POWERSHELL_COMMAND
        : INSTALL_WITH_CURL_COMMAND,
    };
  }

  return {
    currentVersion,
    state: "up-to-date",
    latestVersion: latestRelease.version,
    releaseUrl: latestRelease.releaseUrl,
    downloadUrl: latestRelease.downloadUrl,
  };
}

/**
 * 发起网络请求检查是否有新版本发布
 */
export async function checkForUpdates(
  currentVersion: string,
  fetchReleases: typeof fetch = fetch,
): Promise<UpdateStatus> {
  try {
    const response = await fetchReleases(UPDATE_RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        currentVersion,
        state: "error",
        error: `github-release-http-${response.status}`,
      };
    }

    return createUpdateStatusFromGitHubReleases(currentVersion, await response.json());
  } catch (error) {
    return {
      currentVersion,
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 规范化更新偏好设置对象
 */
export function normalizeUpdateSettings(input: unknown): AppUpdateSettings {
  if (!isRecord(input)) {
    return DEFAULT_UPDATE_SETTINGS;
  }

  const automaticCheck =
    input.automaticCheck === undefined
      ? DEFAULT_UPDATE_SETTINGS.automaticCheck
      : input.automaticCheck === true;
  const automaticDownload = automaticCheck
    ? input.automaticDownload === undefined
      ? DEFAULT_UPDATE_SETTINGS.automaticDownload
      : input.automaticDownload === true
    : false;

  return {
    automaticCheck,
    automaticDownload,
  };
}

function findLatestMdEditorRelease(payload: unknown): PublishedRelease | null {
  const releases = Array.isArray(payload) ? payload : [payload];

  for (const release of releases) {
    if (!isRecord(release) || release.draft === true || release.prerelease === true) {
      continue;
    }

    const version = parsePublishedVersionTag(readString(release.tag_name));
    if (!version) {
      continue;
    }

    return {
      version,
      releaseUrl: readString(release.html_url) ?? undefined,
      downloadUrl: readDmgDownloadUrl(release.assets),
    };
  }

  return null;
}

function parsePublishedVersionTag(tagName: string | null): string | null {
  const value = tagName?.trim();
  if (!value) {
    return null;
  }

  const tapReleaseMatch = value.match(/^md-editor-v(.+)$/u);
  if (tapReleaseMatch) {
    return tapReleaseMatch[1] ?? null;
  }

  const sourceReleaseMatch = value.match(/^v(.+)$/u);
  return sourceReleaseMatch?.[1] ?? null;
}

function readDmgDownloadUrl(input: unknown): string | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  for (const asset of input) {
    if (!isRecord(asset)) {
      continue;
    }
    const name = readString(asset.name);
    const downloadUrl = readString(asset.browser_download_url);
    if (name?.toLowerCase().endsWith(".dmg") && downloadUrl) {
      return downloadUrl;
    }
  }

  return undefined;
}

function parseSemver(input: string): SemverParts | null {
  const match = input
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
    prerelease: match[4] ?? null,
  };
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) {
      continue;
    }
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);
      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
    }

    const compared = leftPart.localeCompare(rightPart, undefined, { numeric: true });
    if (compared !== 0) {
      return compared > 0 ? 1 : -1;
    }
  }

  return 0;
}
