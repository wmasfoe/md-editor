import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changeLanguage } from "@md-editor/i18n";
import {
  updateDownloadProgress,
  updateStatusMessage,
} from "../../src/components/settings/settingsUtils";
import type { UpdateStatus } from "../../src/app/settings/app-settings";

const settingsDialogSource = readFileSync(
  new URL("../../src/components/SettingsDialog.tsx", import.meta.url),
  "utf8",
);
const otherPanelSource = readFileSync(
  new URL("../../src/components/settings/OtherSettingsPanel.tsx", import.meta.url),
  "utf8",
);
const updatePanelSource = readFileSync(
  new URL("../../src/components/settings/UpdateSettingsPanel.tsx", import.meta.url),
  "utf8",
);

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { currentVersion: "0.15.1", state: "idle", installKind: "app", ...partial };
}

describe("updateDownloadProgress", () => {
  it("returns nothing outside download/install states", () => {
    expect(updateDownloadProgress(status({ state: "available" }))).toBeNull();
    expect(updateDownloadProgress(status({ state: "downloaded" }))).toBeNull();
  });

  it("computes a determinate percentage when the total size is known", () => {
    const progress = updateDownloadProgress(
      status({ state: "downloading", downloadedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 }),
    );
    expect(progress?.percent).toBe(25);
    expect(progress?.label).toContain("1.0 MB");
    expect(progress?.label).toContain("4.0 MB");
  });

  it("degrades to a weak indicator when the total size is unknown", () => {
    const progress = updateDownloadProgress(
      status({ state: "downloading", downloadedBytes: 2048, totalBytes: 0 }),
    );
    expect(progress?.percent).toBe(8);
    expect(progress?.label).toContain("2.0 KB");
  });

  it("never exceeds 100 percent", () => {
    const progress = updateDownloadProgress(
      status({ state: "downloading", downloadedBytes: 900, totalBytes: 100 }),
    );
    expect(progress?.percent).toBe(100);
  });

  it("reports an indeterminate-complete bar while installing", () => {
    expect(updateDownloadProgress(status({ state: "installing" }))).toEqual({
      percent: 100,
      label: expect.stringContaining("安装"),
    });
  });
});

describe("update settings tab wiring", () => {
  it("registers a dedicated updates tab before the general tab", () => {
    const updatesTab = settingsDialogSource.indexOf('id: "updates"');
    const generalTab = settingsDialogSource.indexOf('label: t("settings.tabs.general")');
    expect(updatesTab).toBeGreaterThan(-1);
    expect(generalTab).toBeGreaterThan(updatesTab);
    expect(settingsDialogSource).toContain("UpdateSettingsPanel");
  });

  it("keeps the general tab free of update controls", () => {
    expect(otherPanelSource).not.toContain("updateStatus");
    expect(otherPanelSource).not.toContain("onCheckForUpdates");
    expect(otherPanelSource).not.toContain("UpdateReleaseNotes");
    expect(otherPanelSource).not.toContain("update-settings-title");
  });

  it("reuses the shared release-notes renderer and prompt-state skip path", () => {
    expect(updatePanelSource).toContain("UpdateReleaseNotes");
    expect(updatePanelSource).toContain("settings.updates.actions.skipVersion");
    expect(updatePanelSource).toContain("readReleaseNotesEntry");
    expect(settingsDialogSource).toContain("skipUpdateVersion");
  });

  it("offers both changelog entry points without hardcoded urls in the panel", () => {
    expect(settingsDialogSource).toContain("APP_CHANGELOG_URL");
    expect(settingsDialogSource).toContain("APP_RELEASES_URL");
    expect(updatePanelSource).not.toContain("https://editor.jiaqi.im/changelog");
  });
});

describe("updateStatusMessage localization", () => {
  const chinesePattern = /[\u4e00-\u9fff]/u;

  it("keeps the Chinese wording for zh", async () => {
    await changeLanguage("zh");
    const message = updateStatusMessage(
      status({ state: "available", latestVersion: "0.16.0", currentVersion: "0.15.1" }),
    );
    expect(message).toContain("0.16.0");
    expect(message).toMatch(chinesePattern);
  });

  it("returns English copy for en instead of hardcoded Chinese", async () => {
    await changeLanguage("en");
    try {
      const message = updateStatusMessage(
        status({ state: "available", latestVersion: "0.16.0", currentVersion: "0.15.1" }),
      );
      expect(message).toContain("0.16.0");
      expect(message).not.toMatch(chinesePattern);
    } finally {
      await changeLanguage("zh");
    }
  });

  it("falls back to a localized unknown-error label when the updater gives none", async () => {
    await changeLanguage("en");
    try {
      const message = updateStatusMessage(status({ state: "error" }));
      expect(message).not.toMatch(chinesePattern);
    } finally {
      await changeLanguage("zh");
    }
  });
});
