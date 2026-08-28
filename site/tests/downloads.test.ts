import { describe, expect, it } from "vitest";
import {
  buildDownloadCatalog,
  getPlatformInstall,
  MACOS_QUARANTINE_COMMAND,
  UNIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from "../lib/downloads";
import { GITHUB_RELEASES_URL } from "../lib/site-links";

describe("buildDownloadCatalog", () => {
  it("builds per-platform primary assets for a stable version", () => {
    const catalog = buildDownloadCatalog("v0.4.4");

    expect(catalog.macos.primary).toEqual({
      href: "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_aarch64.dmg",
      fileName: "Inkpoint_0.4.4_aarch64.dmg",
      label: "下载 macOS",
    });
    expect(catalog.linux.primary.fileName).toBe("Inkpoint_0.4.4_x86_64.AppImage");
    expect(catalog.linux.secondary).toEqual([
      {
        href: "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.4.4/Inkpoint_0.4.4_aarch64.AppImage",
        fileName: "Inkpoint_0.4.4_aarch64.AppImage",
        label: "ARM64 AppImage",
      },
    ]);
    expect(catalog.windows.primary.fileName).toBe("Inkpoint_0.4.4_x64-setup.exe");
    expect(catalog.windows.secondary[0]?.fileName).toBe("Inkpoint_0.4.4_arm64-setup.exe");
    expect(catalog.allPackagesUrl).toBe(GITHUB_RELEASES_URL);
  });

  it("falls back to the public releases list when version is missing", () => {
    const catalog = buildDownloadCatalog();
    expect(catalog.macos.primary.href).toBe(GITHUB_RELEASES_URL);
    expect(catalog.macos.primary.fileName).toBeUndefined();
    expect(catalog.linux.secondary).toEqual([]);
    expect(catalog.windows.secondary).toEqual([]);
  });
});

describe("getPlatformInstall", () => {
  it("shares the unix script on macOS and Linux, and folds quarantine into macOS extra", () => {
    expect(getPlatformInstall("macos")).toMatchObject({
      command: UNIX_INSTALL_COMMAND,
      recommended: true,
      extra: { command: MACOS_QUARANTINE_COMMAND },
    });
    expect(getPlatformInstall("linux").command).toBe(UNIX_INSTALL_COMMAND);
    expect(getPlatformInstall("linux").extra).toBeUndefined();
    expect(getPlatformInstall("windows")).toEqual({
      title: "PowerShell 一键安装",
      command: WINDOWS_INSTALL_COMMAND,
      recommended: false,
    });
  });
});
