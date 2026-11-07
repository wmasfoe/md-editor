import { describe, expect, it } from "vitest";
import {
  isVersionSkipped,
  resolveUpdateNoticeChoice,
  selectUpdatePresentation,
  shouldAutoDownloadUpdate,
  shouldPresentUpdateNotice,
} from "../../../src/app/updates/presentation";
import { shouldShowEditorUpdateAction } from "../../../src/app/updates/update-status";
import type { UpdateStatus } from "../../../src/app/settings/app-settings";

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { currentVersion: "0.15.1", state: "available", ...partial };
}

describe("selectUpdatePresentation", () => {
  it("shows the release-notes notice once for a new version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }),
    ).toEqual({ notice: "release-notes" });
  });

  it("holds the notice until the first frame has painted", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: false,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("none");
  });

  it("does not notify twice for the same version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: { lastNotifiedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("none");
  });

  it("does not notify a skipped version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: { lastNotifiedVersion: "0.16.0", skippedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("none");
  });

  it("notifies again when a newer version appears after a skip", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.17.0" }),
        promptState: { skippedVersion: "0.16.0", lastNotifiedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("release-notes");
  });

  it("normalizes v-prefixed versions before comparing", () => {
    expect(
      shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), { promptState: {} }),
    ).toBe(true);
    expect(
      shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), {
        promptState: { lastNotifiedVersion: "0.16.0" },
      }),
    ).toBe(false);
  });

  it("does not open an empty notice when notes have no content", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: true,
        hasReleaseNotes: false,
      }),
    ).toEqual({ notice: "none" });
  });

  it("does not present a version postponed with 「稍后」 in this session", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        postponedVersion: "0.16.0",
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("none");
  });

  it("still presents a newer version than the postponed one", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.17.0" }),
        promptState: {},
        postponedVersion: "0.16.0",
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }).notice,
    ).toBe("release-notes");
  });
});

describe("isVersionSkipped", () => {
  it("only matches the exact skipped version, ignoring a v prefix", () => {
    expect(
      isVersionSkipped(status({ latestVersion: "0.16.0" }), { skippedVersion: "0.16.0" }),
    ).toBe(true);
    expect(
      isVersionSkipped(status({ latestVersion: "v0.16.0" }), { skippedVersion: "0.16.0" }),
    ).toBe(true);
  });

  it("does not treat a newer version as skipped", () => {
    expect(
      isVersionSkipped(status({ latestVersion: "0.17.0" }), { skippedVersion: "0.16.0" }),
    ).toBe(false);
    expect(isVersionSkipped(status({ latestVersion: "0.16.0" }), {})).toBe(false);
  });
});

describe("shouldAutoDownloadUpdate", () => {
  const available = status({ latestVersion: "0.16.0" });

  it("downloads when auto-download is on and nothing blocks it", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: available,
        promptState: {},
        automaticDownload: true,
        noticePending: false,
      }),
    ).toBe(true);
  });

  it("respects the automatic-download preference", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: available,
        promptState: {},
        automaticDownload: false,
        noticePending: false,
      }),
    ).toBe(false);
  });

  it("waits for the release-notes notice before downloading", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: available,
        promptState: {},
        automaticDownload: true,
        noticePending: true,
      }),
    ).toBe(false);
  });

  it("never downloads a skipped version (MAJOR-1 regression)", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: available,
        promptState: { skippedVersion: "0.16.0" },
        automaticDownload: true,
        noticePending: false,
      }),
    ).toBe(false);
  });

  it("resumes downloading for a version newer than the skipped one", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: status({ latestVersion: "0.17.0" }),
        promptState: { skippedVersion: "0.16.0" },
        automaticDownload: true,
        noticePending: false,
      }),
    ).toBe(true);
  });

  it("never downloads a version postponed with 「稍后」 in this session", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: available,
        promptState: {},
        postponedVersion: "0.16.0",
        automaticDownload: true,
        noticePending: false,
      }),
    ).toBe(false);
  });
});

describe("resolveUpdateNoticeChoice", () => {
  it("「稍后」 neither downloads nor persists anything, even with auto-download on", () => {
    const promptState = { lastNotifiedVersion: "0.15.0" };
    const resolution = resolveUpdateNoticeChoice("later", "0.16.0", promptState);
    expect(resolution.download).toBe(false);
    expect(resolution.postponedVersion).toBe("0.16.0");
    // 不写 lastNotifiedVersion：下次启动必须重新提示。
    expect(resolution.promptState).toBe(promptState);
  });

  it("「立即更新」 downloads and records the version as notified", () => {
    const resolution = resolveUpdateNoticeChoice("update", "0.16.0", {});
    expect(resolution.download).toBe(true);
    expect(resolution.promptState).toEqual({ lastNotifiedVersion: "0.16.0" });
  });

  it("「跳过此版本」 persists the skip without downloading", () => {
    const resolution = resolveUpdateNoticeChoice("skip", "0.16.0", {});
    expect(resolution.download).toBe(false);
    expect(resolution.promptState).toEqual({
      lastNotifiedVersion: "0.16.0",
      skippedVersion: "0.16.0",
    });
  });

  it("a postponed version is prompted again after restart (in-memory state is gone)", () => {
    const { promptState } = resolveUpdateNoticeChoice("later", "0.16.0", {});
    expect(shouldPresentUpdateNotice(status({ latestVersion: "0.16.0" }), { promptState })).toBe(
      true,
    );
  });
});

describe("shouldShowEditorUpdateAction", () => {
  it("drops the title-bar CTA for a skipped version", () => {
    expect(
      shouldShowEditorUpdateAction(status({ latestVersion: "0.16.0" }), {
        skippedVersion: "0.16.0",
      }),
    ).toBe(false);
    expect(shouldShowEditorUpdateAction(status({ latestVersion: "0.16.0" }), {})).toBe(true);
  });

  it("keeps the restart entry even when the version was skipped before download", () => {
    // 已下载后必须有重启入口，否则用户无法完成更新。
    for (const state of ["downloaded", "installing", "installed"] as const) {
      expect(
        shouldShowEditorUpdateAction(status({ state, latestVersion: "0.16.0" }), {
          skippedVersion: "0.16.0",
        }),
      ).toBe(true);
    }
  });

  it("stays hidden for idle and up-to-date states", () => {
    expect(shouldShowEditorUpdateAction(status({ state: "idle" }))).toBe(false);
    expect(shouldShowEditorUpdateAction(status({ state: "up-to-date" }))).toBe(false);
  });
});
