import { describe, expect, it } from "vitest";
import {
  isVersionSkipped,
  selectUpdatePresentation,
  shouldAutoDownloadUpdate,
  shouldPresentUpdateNotice,
} from "../../../src/app/updates/presentation";
import type { UpdateStatus } from "../../../src/app/settings/app-settings";

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { currentVersion: "0.15.1", state: "available", installKind: "app", ...partial };
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
    expect(shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), {})).toBe(true);
    expect(
      shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), {
        lastNotifiedVersion: "0.16.0",
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

  it("never presents anything for manual install flows", () => {
    expect(
      selectUpdatePresentation({
        status: status({ installKind: "manual", latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: true,
        hasReleaseNotes: true,
      }),
    ).toEqual({ notice: "none" });
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

  it("stays out of manual-install channels", () => {
    expect(
      shouldAutoDownloadUpdate({
        status: status({ latestVersion: "0.16.0", installKind: "manual" }),
        promptState: {},
        automaticDownload: true,
        noticePending: false,
      }),
    ).toBe(false);
  });
});
