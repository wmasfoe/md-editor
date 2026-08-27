/**
 * 官网对外链接与 macOS DMG 直链约定。
 *
 * stable 产物发布在公开 tap 仓库（源码仓可能为私有，直接链 asset 会 404）。
 * 历史版本页也指向同一公开 Release 列表，便于用户浏览全部 DMG。
 */

/** 本项目源码仓库 */
export const GITHUB_REPO_URL = "https://github.com/wmasfoe/md-editor";

/** 公开 release / 历史版本列表（含 DMG） */
export const GITHUB_RELEASES_URL = "https://github.com/wmasfoe/homebrew-tap/releases";

const TAP_RELEASE_REPO = "wmasfoe/homebrew-tap";

/**
 * 根据语义化版本构造最新 macOS DMG 直链。
 * 文件名与 release workflow / cask 约定一致：Markdown.Editor_{version}_aarch64.dmg
 */
export function buildMacosDmgUrl(version: string): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid macOS DMG version: ${version}`);
  }

  const tag = `md-editor-v${normalized}`;
  const fileName = `Markdown.Editor_${normalized}_aarch64.dmg`;
  return `https://github.com/${TAP_RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

/**
 * 根据语义化版本构造 Linux AppImage 直链。
 */
export function buildLinuxAppImageUrl(
  version: string,
  arch: "x86_64" | "aarch64" = "x86_64",
): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid Linux version: ${version}`);
  }

  const tag = `md-editor-v${normalized}`;
  const fileName = `Markdown.Editor_${normalized}_${arch}.AppImage`;
  return `https://github.com/${TAP_RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

/**
 * 根据语义化版本构造 Windows Setup.exe 直链。
 */
export function buildWindowsSetupUrl(version: string, arch: "x64" | "arm64" = "x64"): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new Error(`Invalid Windows version: ${version}`);
  }

  const tag = `md-editor-v${normalized}`;
  const fileName = `Markdown.Editor_${normalized}_${arch}-setup.exe`;
  return `https://github.com/${TAP_RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

/** 去掉可选 v 前缀；空串视为无效。 */
export function normalizeVersion(version: string): string | null {
  const value = version.trim().replace(/^v/iu, "");
  return value.length > 0 ? value : null;
}
